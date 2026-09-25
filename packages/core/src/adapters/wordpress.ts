import type { WarningCode } from '@seo/shared';
import { AppError } from '../errors.js';
import { stripHtml } from '../html.js';
import { assertPublicDestination } from '../url.js';
import type {
  ConnectionResult,
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

const YOAST_KEYS = {
  focusKeyword: '_yoast_wpseo_focuskw',
  metaDescription: '_yoast_wpseo_metadesc',
  title: '_yoast_wpseo_title',
} as const;

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
      const [yoastActive, yoastMetaExposed] = await Promise.all([
        this.detectYoast(),
        this.detectYoastMetaExposed(),
      ]);
      const warnings: WarningCode[] = [];
      if (yoastActive === false) warnings.push('YOAST_NOT_DETECTED');
      if (yoastMetaExposed === false) warnings.push('YOAST_META_NOT_EXPOSED');
      return {
        ok: true,
        message: 'OK',
        details: { yoastActive, yoastMetaExposed, siteName: me.name },
        warnings,
      };
    } catch (err) {
      if (err instanceof AppError) return { ok: false, message: err.code };
      throw err;
    }
  }

  private async detectYoast(): Promise<boolean | null> {
    try {
      const root = await this.requestUrl<{ namespaces?: string[] }>(`${this.base}/wp-json/`, {
        auth: false,
      });
      return (root.namespaces ?? []).some((n) => n.startsWith('yoast/'));
    } catch {
      return null;
    }
  }

  /** Si el meta de Yoast está registrado con show_in_rest aparece en `meta` del post. */
  private async detectYoastMetaExposed(): Promise<boolean | null> {
    try {
      const posts = await this.request<WpPost[]>('/posts?per_page=1&context=edit&_fields=id,meta');
      const first = posts[0];
      if (!first?.meta) return posts.length === 0 ? null : false;
      return YOAST_KEYS.metaDescription in first.meta;
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

  private toBody(input: Partial<CreatePostInput>): Record<string, unknown> {
    const body: Record<string, unknown> = {};
    if (input.title !== undefined) body['title'] = input.title;
    if (input.content !== undefined) body['content'] = input.content;
    if (input.slug !== undefined) body['slug'] = input.slug;
    if (input.status !== undefined) body['status'] = input.status;
    if (input.excerpt !== undefined) body['excerpt'] = input.excerpt;
    if (input.categoryId) body['categories'] = [input.categoryId];
    return body;
  }

  /**
   * Yoast: el meta solo se acepta por REST si está registrado con show_in_rest. Lo enviamos aparte
   * (para no fallar el post entero) y lo leemos de vuelta para saber si de verdad se aplicó.
   */
  private async applySeo(id: number, seo: CreatePostInput['seo']): Promise<WarningCode[]> {
    if (!seo) return [];
    const meta: Record<string, string> = {};
    if (seo.focusKeyword) meta[YOAST_KEYS.focusKeyword] = seo.focusKeyword;
    if (seo.metaDescription) meta[YOAST_KEYS.metaDescription] = seo.metaDescription;
    if (seo.title) meta[YOAST_KEYS.title] = seo.title;
    if (Object.keys(meta).length === 0) return [];

    try {
      await this.request<WpPost>(`/posts/${id}`, { method: 'POST', body: { meta } });
      const back = await this.request<WpPost>(`/posts/${id}?context=edit&_fields=id,meta`);
      const check = seo.metaDescription
        ? YOAST_KEYS.metaDescription
        : (Object.keys(meta)[0] ?? YOAST_KEYS.metaDescription);
      return back.meta?.[check] === meta[check] ? [] : ['YOAST_META_NOT_EXPOSED'];
    } catch (err) {
      if (err instanceof AppError && err.code === 'WP_AUTH_FAILED') throw err;
      return ['YOAST_META_NOT_EXPOSED'];
    }
  }
}
