import { AppError } from '../errors.js';
import { decodeEntities, stripHtml } from '../html.js';
import { safeFetch } from '../url.js';
import type { ContentItem, ContentSample, SiteReader } from './index.js';

export interface CrawlerReaderOptions {
  baseUrl: string;
  allowPrivateHosts: boolean;
  fetchFn?: typeof fetch | undefined;
  /** Páginas que se descargan como mucho (además se respeta robots.txt). */
  maxPages?: number;
}

export interface CrawledPage {
  url: string;
  title: string;
  body: string;
  type: 'page' | 'post' | 'product';
  /** Encabezados h1-h3 de la página, para deducir temas. */
  headings: string[];
}

const DEFAULT_MAX_PAGES = 40;
const MAX_SITEMAP_URLS = 500;
const MAX_CHILD_SITEMAPS = 6;
const MAX_HTML_BYTES = 2_000_000;
const MAX_BODY_CHARS = 8_000;
const CONCURRENCY = 4;
const CACHE_MS = 10 * 60_000;

/** El mismo rastreo sirve a outline y write del mismo artículo: se cachea unos minutos por sitio. */
const cache = new Map<string, { at: number; pages: Promise<CrawledPage[]> }>();

/** Solo para tests. */
export function clearCrawlerCache(): void {
  cache.clear();
}

/**
 * Lector de cualquier web pública (sin conector ni credenciales): descubre las páginas por el
 * sitemap (o, si no hay, los enlaces de la portada), respeta robots.txt y extrae título y texto.
 * Sirve para analizar el sitio (voz de marca, seeds, enlazado interno), nunca para publicar.
 */
export class CrawlerReader implements SiteReader {
  private readonly base: URL;
  private readonly maxPages: number;

  constructor(private readonly opts: CrawlerReaderOptions) {
    this.base = new URL(opts.baseUrl);
    this.maxPages = opts.maxPages ?? DEFAULT_MAX_PAGES;
  }

  async listContent(limit: number): Promise<ContentItem[]> {
    const pages = await this.pages();
    return pages
      .filter((p) => p.title)
      .slice(0, limit)
      .map((p, i) => ({ id: i + 1, title: p.title, url: p.url, type: p.type }));
  }

  async getSamples(limit: number): Promise<ContentSample[]> {
    const pages = await this.pages();
    // Primero los artículos y fichas (texto propio), después las páginas.
    const rank = { post: 0, product: 1, page: 2 } as const;
    return pages
      .filter((p) => p.body.length > 80)
      .sort((a, b) => rank[a.type] - rank[b.type])
      .slice(0, limit)
      .map((p) => ({ title: p.title, body: p.body, type: p.type }));
  }

  async listCategories(limit: number): Promise<string[]> {
    const pages = await this.pages();
    // Secciones del sitio: los directorios con varias páginas (/servicios/x, /servicios/y).
    const counts = new Map<string, number>();
    for (const p of pages) {
      const segments = new URL(p.url).pathname.split('/').filter(Boolean);
      const parent = segments.length >= 2 ? segments[segments.length - 2] : undefined;
      if (!parent || IGNORED_SECTIONS.has(parent.toLowerCase()) || /^\d+$/.test(parent)) continue;
      const name = humanizeSlug(parent);
      if (name.length >= 3) counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    const sections = [...counts.entries()]
      .filter(([, n]) => n >= 2)
      .sort((a, b) => b[1] - a[1])
      .map(([name]) => name);
    const home = pages.find((p) => isHome(p.url, this.base)) ?? pages[0];
    const headings = (home?.headings ?? [])
      .map((h) => h.toLowerCase())
      .filter((t) => t.length >= 4 && t.length <= 40 && t.split(' ').length <= 4);
    return [...new Set([...sections, ...headings])].slice(0, limit);
  }

  /** Páginas rastreadas (cacheadas). Lanza CONNECTION_FAILED si no responde ni la portada. */
  pages(): Promise<CrawledPage[]> {
    const key = `${this.base.toString()}|${this.maxPages}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.pages;
    const pages = this.crawl();
    cache.set(key, { at: Date.now(), pages });
    pages.catch(() => cache.delete(key));
    return pages;
  }

  private async crawl(): Promise<CrawledPage[]> {
    const robots = await this.robots();
    const fromSitemaps = await this.sitemapUrls(robots.sitemaps);
    const home = this.base.toString();
    const homePage = await this.fetchPage(home);
    if (!homePage) {
      throw new AppError('CONNECTION_FAILED', `Could not reach ${this.base.hostname}`, {
        httpStatus: 502,
        retryable: true,
      });
    }

    let candidates = fromSitemaps;
    if (!candidates.length) candidates = homePage.links;
    const urls = [
      ...new Set(candidates.map((u) => canonicalUrl(u)).filter((u) => u !== canonicalUrl(home))),
    ]
      .filter((u) => this.sameSite(u) && !robots.disallows(new URL(u).pathname) && isHtmlPath(u))
      .slice(0, this.maxPages - 1);

    const pages: CrawledPage[] = homePage.page ? [homePage.page] : [];
    for (let i = 0; i < urls.length; i += CONCURRENCY) {
      const batch = await Promise.all(urls.slice(i, i + CONCURRENCY).map((u) => this.fetchPage(u)));
      for (const r of batch) if (r?.page) pages.push(r.page);
    }
    return pages;
  }

  private async get(url: string): Promise<{ text: string; url: string; type: string } | null> {
    const r = await safeFetch(url, {
      allowPrivate: this.opts.allowPrivateHosts,
      fetchFn: this.opts.fetchFn,
    });
    if (!r || !r.res.ok) {
      await r?.res.body?.cancel().catch(() => undefined);
      return null;
    }
    const type = r.res.headers.get('content-type') ?? '';
    const text = (await r.res.text().catch(() => '')).slice(0, MAX_HTML_BYTES);
    return { text, url: r.url, type };
  }

  private async robots(): Promise<Robots> {
    const r = await this.get(new URL('/robots.txt', this.base).toString());
    return parseRobots(r?.text ?? '');
  }

  /** URLs de los sitemaps (los índices se abren un nivel), las modificadas más recientemente antes. */
  private async sitemapUrls(declared: string[]): Promise<string[]> {
    const roots = declared.length
      ? declared
      : ['/sitemap.xml', '/sitemap_index.xml'].map((p) => new URL(p, this.base).toString());
    const entries: SitemapEntry[] = [];
    const visit = async (url: string, depth: number): Promise<void> => {
      if (entries.length >= MAX_SITEMAP_URLS || !this.sameSite(url)) return;
      const r = await this.get(url);
      if (!r) return;
      const parsed = parseSitemap(r.text);
      if (parsed.kind === 'index') {
        if (depth > 0) return;
        // Antes los de contenido (posts, páginas, productos) que los de imágenes, autores o etiquetas.
        const children = parsed.entries
          .map((e) => e.loc)
          .sort((a, b) => sitemapPriority(a) - sitemapPriority(b))
          .slice(0, MAX_CHILD_SITEMAPS);
        for (const child of children) await visit(child, depth + 1);
      } else {
        entries.push(...parsed.entries);
      }
    };
    for (const root of roots) {
      await visit(root, 0);
      if (entries.length) break;
    }
    return entries
      .sort((a, b) => (b.lastmod ?? '').localeCompare(a.lastmod ?? ''))
      .slice(0, MAX_SITEMAP_URLS)
      .map((e) => e.loc);
  }

  private async fetchPage(
    url: string,
  ): Promise<{ page: CrawledPage | null; links: string[] } | null> {
    const r = await this.get(url);
    if (!r || (r.type && !r.type.includes('html'))) return null;
    if (!this.sameSite(r.url)) return null;
    const links = extractPageLinks(r.text, r.url);
    const page = parsePage(r.text, canonicalUrl(r.url));
    return { page, links };
  }

  private sameSite(url: string): boolean {
    try {
      return bareHost(new URL(url).hostname) === bareHost(this.base.hostname);
    } catch {
      return false;
    }
  }
}

// ---- Parsing ---------------------------------------------------------------

interface Robots {
  sitemaps: string[];
  disallows(path: string): boolean;
}

/** robots.txt: líneas Sitemap y las reglas del grupo `User-agent: *` (Allow gana si es más larga). */
export function parseRobots(text: string): Robots {
  const sitemaps: string[] = [];
  const allow: string[] = [];
  const disallow: string[] = [];
  let inStar = false;
  let lastWasAgent = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    const m = /^([a-z-]+)\s*:\s*(.*)$/i.exec(line);
    if (!m) continue;
    const field = (m[1] ?? '').toLowerCase();
    const value = (m[2] ?? '').trim();
    if (field === 'sitemap') {
      if (/^https?:\/\//i.test(value)) sitemaps.push(value);
      continue;
    }
    if (field === 'user-agent') {
      inStar = lastWasAgent ? inStar || value === '*' : value === '*';
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!inStar || !value) continue;
    if (field === 'disallow') disallow.push(value);
    if (field === 'allow') allow.push(value);
  }
  const matches = (rule: string, path: string): boolean => {
    const anchored = rule.endsWith('$');
    const body = (anchored ? rule.slice(0, -1) : rule)
      .split('*')
      .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
      .join('.*');
    return new RegExp(`^${body}${anchored ? '$' : ''}`).test(path);
  };
  return {
    sitemaps,
    disallows(path) {
      const d = Math.max(-1, ...disallow.filter((r) => matches(r, path)).map((r) => r.length));
      const a = Math.max(-1, ...allow.filter((r) => matches(r, path)).map((r) => r.length));
      return d >= 0 && d > a;
    },
  };
}

interface SitemapEntry {
  loc: string;
  lastmod?: string;
}

export function parseSitemap(xml: string): { kind: 'index' | 'urlset'; entries: SitemapEntry[] } {
  const kind = /<sitemapindex\b/i.test(xml) ? 'index' : 'urlset';
  const tag = kind === 'index' ? 'sitemap' : 'url';
  const entries: SitemapEntry[] = [];
  for (const m of xml.matchAll(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'gi'))) {
    const block = m[1] ?? '';
    const loc = xmlText(/<loc>([\s\S]*?)<\/loc>/i.exec(block)?.[1]);
    if (!loc || !/^https?:\/\//i.test(loc)) continue;
    const lastmod = xmlText(/<lastmod>([\s\S]*?)<\/lastmod>/i.exec(block)?.[1]);
    entries.push(lastmod ? { loc, lastmod } : { loc });
  }
  return { kind, entries };
}

const xmlText = (s: string | undefined): string =>
  decodeEntities((s ?? '').replace(/^<!\[CDATA\[|\]\]>$/g, '')).trim();

const sitemapPriority = (url: string): number => {
  const u = url.toLowerCase();
  if (/(image|video|author|tag|attachment|media)/.test(u)) return 3;
  if (/(post|blog|article|news|noticia|product|producto|page|pagina)/.test(u)) return 0;
  return 1;
};

/** Título, texto principal y tipo de una página HTML; null si pide no indexarse. */
export function parsePage(html: string, url: string): CrawledPage | null {
  const robotsMeta = metaContent(html, 'name', 'robots');
  if (robotsMeta && /noindex/i.test(robotsMeta)) return null;

  const headings = [...html.matchAll(/<(h[1-3])\b[^>]*>([\s\S]*?)<\/\1>/gi)]
    .map((m) => stripHtml(m[2] ?? ''))
    .filter(Boolean);
  const h1 = stripHtml(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1] ?? '');
  const ogTitle = decodeEntities(metaContent(html, 'property', 'og:title') ?? '').trim();
  const docTitle = stripHtml(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '');
  // El h1 suele ser el título limpio; el <title> lleva la marca detrás ("Título | Marca").
  const title =
    (h1.length >= 3 && h1.length <= 150 ? h1 : '') ||
    ogTitle ||
    docTitle.split(/\s[|–—·-]\s/)[0]?.trim() ||
    docTitle;

  // Texto principal: <main> o <article> si los hay; si no, el <body> sin cabecera, menú ni pie.
  const region =
    /<main\b[^>]*>([\s\S]*?)<\/main>/i.exec(html)?.[1] ??
    /<article\b[^>]*>([\s\S]*?)<\/article>/i.exec(html)?.[1] ??
    /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(html)?.[1] ??
    html;
  const cleaned = region.replace(
    /<(script|style|noscript|svg|nav|header|footer|form|aside|template)\b[\s\S]*?<\/\1>/gi,
    ' ',
  );
  const body = stripHtml(cleaned).slice(0, MAX_BODY_CHARS);

  return { url, title, body, type: pageType(html, url), headings };
}

function pageType(html: string, url: string): CrawledPage['type'] {
  const og = (metaContent(html, 'property', 'og:type') ?? '').toLowerCase();
  const path = new URL(url).pathname.toLowerCase();
  if (og === 'product' || /\/(product|producto|productos|shop|tienda)\//.test(path)) {
    return 'product';
  }
  if (
    og === 'article' ||
    /\/(blog|news|noticias|articulos|articles|post|posts|actualidad|magazine)\//.test(path) ||
    /\/\d{4}\/\d{2}\//.test(path)
  ) {
    return 'post';
  }
  return 'page';
}

function metaContent(html: string, attr: 'name' | 'property', value: string): string | null {
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = m[0];
    const key = new RegExp(`\\b${attr}\\s*=\\s*["']${value}["']`, 'i');
    if (!key.test(tag)) continue;
    return (
      /\bcontent\s*=\s*"([^"]*)"|\bcontent\s*=\s*'([^']*)'/i
        .exec(tag)
        ?.slice(1)
        .find((v) => v !== undefined) ?? null
    );
  }
  return null;
}

/** Enlaces absolutos de una página (para webs sin sitemap). */
export function extractPageLinks(html: string, pageUrl: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"'#]+)/gi)) {
    try {
      const u = new URL(decodeEntities(m[1] ?? ''), pageUrl);
      if (u.protocol === 'http:' || u.protocol === 'https:') out.push(u.toString());
    } catch {
      // href inválido: se ignora.
    }
  }
  return out;
}

const IGNORED_SECTIONS = new Set([
  'tag',
  'tags',
  'etiqueta',
  'author',
  'autor',
  'page',
  'pagina',
  'wp-content',
  'feed',
  'es',
  'en',
  'ca',
  'fr',
  'de',
  'pt',
  'it',
]);

const humanizeSlug = (slug: string): string => {
  let text = slug;
  try {
    text = decodeURIComponent(slug);
  } catch {
    // Slug mal codificado: se usa tal cual.
  }
  return text
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[-_]+/g, ' ')
    .trim()
    .toLowerCase();
};

const bareHost = (h: string): string => h.toLowerCase().replace(/^www\./, '');

/** Sin fragmento ni parámetros de seguimiento, para no rastrear dos veces la misma página. */
function canonicalUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.hash = '';
    for (const k of [...u.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|ref$)/i.test(k)) u.searchParams.delete(k);
    }
    return u.toString();
  } catch {
    return raw;
  }
}

const isHome = (url: string, base: URL): boolean => {
  try {
    const u = new URL(url);
    return bareHost(u.hostname) === bareHost(base.hostname) && /^\/?$/.test(u.pathname);
  } catch {
    return false;
  }
};

const isHtmlPath = (url: string): boolean => {
  const path = new URL(url).pathname.toLowerCase();
  if (/\/(wp-admin|wp-json|wp-login|cart|carrito|checkout|my-account|mi-cuenta|login)\b/.test(path))
    return false;
  return !/\.(jpe?g|png|gif|webp|avif|svg|pdf|zip|mp4|mp3|xml|json|css|js|ico|txt|docx?|xlsx?)$/.test(
    path,
  );
};
