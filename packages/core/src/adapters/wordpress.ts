import {
  CONNECTOR_VERSION,
  isOlderVersion,
  type ConnectionDetails,
  type SeoPlugin,
  type WarningCode,
} from '@seo/shared';
import { AppError } from '../errors.js';
import { stripHtml } from '../html.js';
import { assertPublicDestination } from '../url.js';
import type {
  AttributedOrder,
  Author,
  StoreProduct,
  ConnectionResult,
  PostInfo,
  ContentItem,
  ContentSample,
  CreatePostInput,
  PublishingAdapter,
} from './index.js';

export interface WordPressAdapterOptions {
  baseUrl: string;
  username: string;
  appPassword: string;
  /** false en producción: bloquea IPs privadas y localhost (SSRF). */
  allowPrivateHosts: boolean;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}

/** Campos de cada plugin SEO. Solo se pueden escribir por REST si están registrados con show_in_rest. */
const SEO_KEYS: Record<
  SeoPlugin,
  { focusKeyword: string; metaDescription: string; title: string }
> = {
  yoast: {
    focusKeyword: '_yoast_wpseo_focuskw',
    metaDescription: '_yoast_wpseo_metadesc',
    title: '_yoast_wpseo_title',
  },
  rankmath: {
    focusKeyword: 'rank_math_focus_keyword',
    metaDescription: 'rank_math_description',
    title: 'rank_math_title',
  },
};
const SCHEMA_KEY = '_seo_autopilot_schema';
const MANAGED_KEY = '_seo_autopilot_managed';

interface StoreApiProduct {
  id: number;
  name?: string;
  permalink?: string;
  prices?: { price?: string; currency_code?: string; currency_minor_unit?: number };
  images?: { id?: number }[];
}

function toStoreProduct(p: StoreApiProduct): StoreProduct {
  const minor = p.prices?.currency_minor_unit ?? 2;
  const raw = p.prices?.price;
  const price =
    raw && /^\d+$/.test(raw)
      ? `${(Number(raw) / 10 ** minor).toFixed(minor).replace('.', ',')} ${p.prices?.currency_code ?? ''}`.trim()
      : null;
  return {
    id: p.id,
    name: stripHtml(p.name ?? ''),
    url: p.permalink ?? '',
    price,
    imageId: p.images?.[0]?.id ?? null,
  };
}

interface Environment {
  seoPlugin: SeoPlugin | null;
  yoastActive: boolean | null;
  rankMathActive: boolean | null;
  connectorVersion: string | null;
  woocommerce: boolean | null;
}

interface WpRendered {
  rendered?: string;
}
interface WpPost {
  id: number;
  link?: string;
  title?: WpRendered;
  content?: WpRendered;
  meta?: Record<string, unknown>;
}

/** Tipos de contenido públicos que leemos. `product` solo existe si hay WooCommerce. */
const CONTENT_TYPES = [
  { path: 'posts', type: 'post' },
  { path: 'pages', type: 'page' },
  { path: 'product', type: 'product' },
] as const;

export class WordPressAdapter implements PublishingAdapter {
  private readonly base: string;
  private readonly auth: string;
  private readonly fetchFn: typeof fetch;

  constructor(private readonly opts: WordPressAdapterOptions) {
    this.base = opts.baseUrl.replace(/\/+$/, '');
    this.auth = `Basic ${Buffer.from(`${opts.username}:${opts.appPassword}`).toString('base64')}`;
    this.fetchFn = opts.fetchFn ?? fetch;
  }

  private async request<T>(
    path: string,
    init: { method?: string; body?: unknown; auth?: boolean } = {},
  ): Promise<T> {
    const url = `${this.base}/wp-json/wp/v2${path}`;
    return this.requestUrl<T>(url, init);
  }

  private async requestUrl<T>(
    url: string,
    init: { method?: string; body?: unknown; auth?: boolean } = {},
  ): Promise<T> {
    if (!this.opts.allowPrivateHosts) await assertPublicDestination(url);
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (init.auth !== false) headers['Authorization'] = this.auth;
    if (init.body !== undefined) headers['Content-Type'] = 'application/json';

    let res: Response;
    try {
      res = await this.fetchFn(url, {
        method: init.method ?? 'GET',
        headers,
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: AbortSignal.timeout(this.opts.timeoutMs ?? 30_000),
      });
    } catch (err) {
      throw new AppError('CONNECTION_FAILED', `Could not reach ${new URL(url).host}`, {
        httpStatus: 502,
        retryable: true,
        cause: err,
      });
    }

    if (res.ok) return (await res.json()) as T;

    const detail = await res
      .json()
      .then((j: unknown) => (j as { message?: string }).message ?? '')
      .catch(() => '');
    if (res.status === 401 || res.status === 403) {
      throw new AppError('WP_AUTH_FAILED', `WordPress rejected the credentials (${res.status})`, {
        httpStatus: 400,
      });
    }
    if (res.status === 404) {
      throw new AppError('WP_REST_NOT_FOUND', 'WordPress REST API not found at this URL', {
        httpStatus: 400,
      });
    }
    throw new AppError('CONNECTION_FAILED', `WordPress responded ${res.status} ${detail}`.trim(), {
      httpStatus: 502,
      retryable: res.status === 429 || res.status >= 500,
    });
  }

  async testConnection(): Promise<ConnectionResult> {
    try {
      const me = await this.request<{ name?: string }>('/users/me?context=edit');
      const env = await this.environment();
      const metaExposed = await this.detectMetaExposed(env.seoPlugin);
      const warnings: WarningCode[] = [];
      if (env.yoastActive === false && env.rankMathActive === false)
        warnings.push('YOAST_NOT_DETECTED');
      if (metaExposed === false) warnings.push('YOAST_META_NOT_EXPOSED');
      if (env.connectorVersion === null) warnings.push('CONNECTOR_NOT_INSTALLED');
      else if (isOlderVersion(env.connectorVersion, CONNECTOR_VERSION))
        warnings.push('CONNECTOR_OUTDATED');
      const details: ConnectionDetails = {
        yoastActive: env.yoastActive,
        rankMathActive: env.rankMathActive,
        seoPlugin: env.seoPlugin,
        yoastMetaExposed: metaExposed,
        connectorVersion: env.connectorVersion,
        woocommerce: env.woocommerce,
      };
      if (me.name) details.siteName = me.name;
      return { ok: true, message: 'OK', details, warnings };
    } catch (err) {
      if (err instanceof AppError) return { ok: false, message: err.code };
      throw err;
    }
  }

  private env: Promise<Environment> | undefined;

  /** Plugins activos según los namespaces REST públicos (y el estado del conector). Se cachea. */
  private environment(): Promise<Environment> {
    this.env ??= (async () => {
      let namespaces: string[] | null;
      try {
        const root = await this.requestUrl<{ namespaces?: string[] }>(`${this.base}/wp-json/`, {
          auth: false,
        });
        namespaces = root.namespaces ?? [];
      } catch {
        namespaces = null;
      }
      const has = (prefix: string): boolean | null =>
        namespaces === null ? null : namespaces.some((n) => n.startsWith(prefix));
      let yoastActive = has('yoast/');
      let rankMathActive = has('rankmath/');
      let woocommerce = has('wc/');
      let connectorVersion: string | null = null;
      if (has('seo-autopilot/')) {
        // El conector lo sabe con certeza (Rank Math no publica namespace hasta configurarlo).
        try {
          const status = await this.requestUrl<{
            version?: string;
            seoPlugin?: string | null;
            woocommerce?: boolean;
          }>(`${this.base}/wp-json/seo-autopilot/v1/status`);
          connectorVersion = status.version ?? '0.0.0';
          if (status.seoPlugin !== undefined) {
            yoastActive = status.seoPlugin === 'yoast';
            rankMathActive = status.seoPlugin === 'rankmath';
          }
          if (typeof status.woocommerce === 'boolean') woocommerce = status.woocommerce;
        } catch {
          connectorVersion = '0.0.0';
        }
      }
      const seoPlugin: SeoPlugin | null = yoastActive
        ? 'yoast'
        : rankMathActive
          ? 'rankmath'
          : null;
      return { seoPlugin, yoastActive, rankMathActive, connectorVersion, woocommerce };
    })();
    return this.env;
  }

  /** Si los campos del plugin SEO están registrados con show_in_rest aparecen en `meta` del post. */
  private async detectMetaExposed(plugin: SeoPlugin | null): Promise<boolean | null> {
    try {
      const posts = await this.request<WpPost[]>('/posts?per_page=1&context=edit&_fields=id,meta');
      const first = posts[0];
      if (!first?.meta) return posts.length === 0 ? null : false;
      const meta = first.meta;
      const plugins: SeoPlugin[] = plugin ? [plugin] : ['yoast', 'rankmath'];
      return plugins.some((p) => SEO_KEYS[p].metaDescription in meta);
    } catch {
      return null;
    }
  }

  async listContent(limit: number): Promise<ContentItem[]> {
    const perType = Math.max(1, Math.ceil(limit / CONTENT_TYPES.length));
    const groups = await Promise.all(
      CONTENT_TYPES.map(async ({ path, type }) => {
        try {
          const items = await this.request<WpPost[]>(
            `/${path}?per_page=${perType}&status=publish&orderby=date&order=desc&_fields=id,link,title`,
          );
          return items.map((p) => ({
            id: p.id,
            title: stripHtml(p.title?.rendered ?? ''),
            url: p.link ?? '',
            type,
          }));
        } catch (err) {
          if (err instanceof AppError && err.code === 'WP_REST_NOT_FOUND') return []; // sin WooCommerce
          throw err;
        }
      }),
    );
    return groups
      .flat()
      .filter((i) => i.url && i.title)
      .slice(0, limit);
  }

  async getSamples(limit: number): Promise<ContentSample[]> {
    const perType = Math.max(1, Math.ceil(limit / CONTENT_TYPES.length));
    const groups = await Promise.all(
      CONTENT_TYPES.map(async ({ path, type }) => {
        try {
          const items = await this.request<WpPost[]>(
            `/${path}?per_page=${perType}&status=publish&_fields=id,title,content`,
          );
          return items.map((p) => ({
            title: stripHtml(p.title?.rendered ?? ''),
            body: stripHtml(p.content?.rendered ?? ''),
            type,
          }));
        } catch (err) {
          if (err instanceof AppError && err.code === 'WP_REST_NOT_FOUND') return [];
          throw err;
        }
      }),
    );
    return groups
      .flat()
      .filter((s) => s.body.length > 80)
      .slice(0, limit);
  }

  async listCategories(limit: number): Promise<string[]> {
    // product_cat solo existe con WooCommerce; va primero porque describe mejor una tienda.
    const groups = await Promise.all(
      ['product_cat', 'categories'].map(async (taxonomy) => {
        try {
          const terms = await this.request<{ name?: string; slug?: string }[]>(
            `/${taxonomy}?per_page=${Math.min(100, limit)}&hide_empty=true&orderby=count&order=desc&_fields=name,slug`,
          );
          return terms
            .filter((t) => t.slug !== 'uncategorized' && t.slug !== 'sin-categoria')
            .map((t) => stripHtml(t.name ?? ''));
        } catch (err) {
          if (err instanceof AppError && err.code === 'WP_REST_NOT_FOUND') return [];
          throw err;
        }
      }),
    );
    return [...new Set(groups.flat().filter(Boolean))].slice(0, limit);
  }

  async createPost(
    input: CreatePostInput,
  ): Promise<{ id: number; url: string; warnings?: WarningCode[] }> {
    const created = await this.request<WpPost>('/posts', {
      method: 'POST',
      body: this.toBody(input),
    });
    const warnings = await this.applySeo(created.id, input.seo);
    return { id: created.id, url: created.link ?? '', warnings };
  }

  async updatePost(
    id: number,
    input: Partial<CreatePostInput>,
  ): Promise<{ warnings?: WarningCode[] }> {
    await this.request<WpPost>(`/posts/${id}`, { method: 'POST', body: this.toBody(input) });
    return { warnings: await this.applySeo(id, input.seo) };
  }

  /**
   * Store API de WooCommerce (pública): busca por el término y, si salen pocos, completa con los
   * más vendidos para que el artículo pueda recomendar algo real de la tienda.
   */
  async searchProducts(query: string, limit: number): Promise<StoreProduct[]> {
    const env = await this.environment();
    if (env.woocommerce === false) return [];
    const get = async (params: string): Promise<StoreProduct[]> => {
      try {
        const items = await this.requestUrl<StoreApiProduct[]>(
          `${this.base}/wp-json/wc/store/v1/products?${params}`,
          { auth: false },
        );
        return items.map(toStoreProduct).filter((p) => p.url);
      } catch (err) {
        if (err instanceof AppError && err.code === 'WP_REST_NOT_FOUND') return [];
        throw err;
      }
    };
    const found = await get(`search=${encodeURIComponent(query)}&per_page=${limit}`);
    if (found.length >= Math.min(3, limit)) return found.slice(0, limit);
    const popular = await get(`orderby=popularity&per_page=${limit}`);
    const seen = new Set(found.map((p) => p.id));
    return [...found, ...popular.filter((p) => !seen.has(p.id))].slice(0, limit);
  }

  async listAuthors(): Promise<Author[]> {
    const users = await this.request<{ id: number; name?: string }[]>(
      '/users?per_page=100&context=edit&capabilities=edit_posts&_fields=id,name',
    );
    return users.map((u) => ({ id: u.id, name: stripHtml(u.name ?? `#${u.id}`) }));
  }

  async getPostsInfo(ids: number[]): Promise<PostInfo[]> {
    const out: PostInfo[] = [];
    for (let i = 0; i < ids.length; i += 100) {
      const chunk = ids.slice(i, i + 100);
      const posts = await this.request<(WpPost & { status?: string })[]>(
        `/posts?include=${chunk.join(',')}&per_page=100&status=any&context=edit&_fields=id,link,status`,
      );
      out.push(
        ...posts.map((p) => ({ id: p.id, url: p.link ?? '', status: p.status ?? 'unknown' })),
      );
    }
    return out;
  }

  async listAttributedOrders(
    after: Date,
    page: number,
  ): Promise<{ orders: AttributedOrder[]; hasMore: boolean } | null> {
    const env = await this.environment();
    if (
      !env.woocommerce ||
      env.connectorVersion === null ||
      isOlderVersion(env.connectorVersion, '1.1.0')
    ) {
      return null;
    }
    try {
      return await this.requestUrl<{ orders: AttributedOrder[]; hasMore: boolean }>(
        `${this.base}/wp-json/seo-autopilot/v1/orders?after=${encodeURIComponent(after.toISOString())}&page=${page}`,
      );
    } catch (err) {
      if (err instanceof AppError && err.code === 'WP_REST_NOT_FOUND') return null;
      throw err;
    }
  }

  private toBody(input: Partial<CreatePostInput>): Record<string, unknown> {
    const body: Record<string, unknown> = {};
    if (input.title !== undefined) body['title'] = input.title;
    if (input.content !== undefined) body['content'] = input.content;
    if (input.slug !== undefined) body['slug'] = input.slug;
    if (input.status !== undefined) body['status'] = input.status;
    if (input.excerpt !== undefined) body['excerpt'] = input.excerpt;
    if (input.categoryId) body['categories'] = [input.categoryId];
    if (input.authorId) body['author'] = input.authorId;
    if (input.featuredMediaId) body['featured_media'] = input.featuredMediaId;
    return body;
  }

  /**
   * Plugin SEO (Yoast o Rank Math): su meta solo se acepta por REST si está registrada con
   * show_in_rest (lo hace el conector). Se envía aparte para no fallar el post entero y se lee de
   * vuelta para saber si de verdad se aplicó. Sin plugin detectado se escriben los dos juegos.
   */
  private async applySeo(id: number, seo: CreatePostInput['seo']): Promise<WarningCode[]> {
    if (!seo) return [];
    const env = await this.environment();
    const plugins: SeoPlugin[] = env.seoPlugin ? [env.seoPlugin] : ['yoast', 'rankmath'];
    const meta: Record<string, string> = {};
    for (const p of plugins) {
      const keys = SEO_KEYS[p];
      if (seo.focusKeyword) meta[keys.focusKeyword] = seo.focusKeyword;
      if (seo.metaDescription) meta[keys.metaDescription] = seo.metaDescription;
      if (seo.title) meta[keys.title] = seo.title;
    }
    const seoKeys = Object.keys(meta);
    if (seo.schemaJson !== undefined) meta[SCHEMA_KEY] = seo.schemaJson;
    if (Object.keys(meta).length === 0) return [];
    meta[MANAGED_KEY] = '1';

    try {
      await this.request<WpPost>(`/posts/${id}`, { method: 'POST', body: { meta } });
      if (seoKeys.length === 0) return [];
      const back = await this.request<WpPost>(`/posts/${id}?context=edit&_fields=id,meta`);
      const checks = plugins.map((p) => {
        const k = SEO_KEYS[p];
        return seo.metaDescription
          ? k.metaDescription
          : seo.focusKeyword
            ? k.focusKeyword
            : k.title;
      });
      return checks.some((key) => back.meta?.[key] === meta[key]) ? [] : ['YOAST_META_NOT_EXPOSED'];
    } catch (err) {
      if (err instanceof AppError && err.code === 'WP_AUTH_FAILED') throw err;
      return ['YOAST_META_NOT_EXPOSED'];
    }
  }
}
