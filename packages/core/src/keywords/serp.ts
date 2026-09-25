import { stripHtml } from '../html.js';
import { assertPublicDestination } from '../url.js';
import type { ExpandContext } from './provider.js';

export interface SerpResult {
  position: number;
  title: string;
  url: string;
  snippet: string;
  /** H2/H3 de la página (vacío si no se pudo leer). */
  headings: string[];
  /** Palabras aproximadas del contenido; null si no se pudo leer. */
  wordCount: number | null;
}

/** Foto de la primera página de Google para una keyword. Se guarda en Article.serp. */
export interface SerpSnapshot {
  query: string;
  fetchedAt: string;
  results: SerpResult[];
  relatedQuestions: string[];
  /** Elementos especiales de la SERP (fragmento destacado, vídeos, shopping…). */
  features: string[];
}

export interface SerpDeps {
  fetchFn: typeof fetch;
  allowPrivateHosts: boolean;
}

const PAGES_TO_READ = 5;
const MAX_HTML_BYTES = 1_500_000;
const MAX_HEADINGS = 25;
const FEATURES: Record<string, string> = {
  answer_box: 'featured_snippet',
  shopping_results: 'shopping',
  inline_videos: 'videos',
  local_results: 'local_pack',
  inline_images: 'images',
  top_stories: 'news',
};

/**
 * Top 10 orgánico (SerpAPI) y la estructura de los primeros resultados, para que el esquema cubra
 * lo que Google ya premia y añada lo que falta. Sin clave o si falla, devuelve null: el pipeline
 * sigue sin SERP.
 */
export async function fetchSerp(
  apiKey: string,
  query: string,
  ctx: ExpandContext,
  deps: SerpDeps,
): Promise<SerpSnapshot | null> {
  const url =
    'https://serpapi.com/search.json?engine=google&num=10' +
    `&q=${encodeURIComponent(query)}&hl=${encodeURIComponent(ctx.language)}&gl=${encodeURIComponent(ctx.country.toLowerCase())}` +
    `&api_key=${encodeURIComponent(apiKey)}`;
  let body: {
    organic_results?: { position?: number; title?: string; link?: string; snippet?: string }[];
    related_questions?: { question?: string }[];
  } & Record<string, unknown>;
  try {
    const res = await deps.fetchFn(url, { signal: AbortSignal.timeout(20_000) });
    if (res.status !== 200) return null;
    body = (await res.json()) as typeof body;
  } catch {
    return null;
  }

  const organic = (body.organic_results ?? [])
    .filter((r) => r.link && r.title)
    .slice(0, 10)
    .map((r, i) => ({
      position: r.position ?? i + 1,
      title: r.title ?? '',
      url: r.link ?? '',
      snippet: r.snippet ?? '',
    }));
  const pages = await Promise.all(
    organic.map((r, i) =>
      i < PAGES_TO_READ ? readPageStructure(r.url, deps) : Promise.resolve(null),
    ),
  );
  return {
    query,
    fetchedAt: new Date().toISOString(),
    results: organic.map((r, i) => ({
      ...r,
      headings: pages[i]?.headings ?? [],
      wordCount: pages[i]?.wordCount ?? null,
    })),
    relatedQuestions: (body.related_questions ?? [])
      .map((q) => q.question?.trim() ?? '')
      .filter(Boolean)
      .slice(0, 8),
    features: Object.entries(FEATURES)
      .filter(([key]) => body[key] !== undefined)
      .map(([, name]) => name),
  };
}

/** Encabezados y longitud de una página de la competencia. Cualquier fallo → null. */
export async function readPageStructure(
  url: string,
  deps: SerpDeps,
): Promise<{ headings: string[]; wordCount: number } | null> {
  try {
    if (!deps.allowPrivateHosts) await assertPublicDestination(url);
    const res = await deps.fetchFn(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SEOAutopilot/1.0)', Accept: 'text/html' },
      signal: AbortSignal.timeout(8_000),
      redirect: 'follow',
    });
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('html')) return null;
    const html = (await res.text()).slice(0, MAX_HTML_BYTES);
    return extractStructure(html);
  } catch {
    return null;
  }
}

export function extractStructure(html: string): { headings: string[]; wordCount: number } {
  const main = html
    .replace(/<(script|style|noscript|svg|nav|footer|header|aside)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');
  const headings = [...main.matchAll(/<(h2|h3)\b[^>]*>([\s\S]*?)<\/\1>/gi)]
    .map(
      (m) =>
        `${(m[1] ?? 'h2').toLowerCase() === 'h3' ? '  ' : ''}${stripHtml(m[2] ?? '').slice(0, 120)}`,
    )
    .filter((h) => h.trim().length > 1)
    .slice(0, MAX_HEADINGS);
  const text = stripHtml(main);
  return { headings, wordCount: text ? text.split(' ').length : 0 };
}

/** Longitud mediana de la competencia (solo páginas leídas con contenido razonable). */
export function medianWordCount(snapshot: SerpSnapshot): number | null {
  const counts = snapshot.results
    .map((r) => r.wordCount)
    .filter((n): n is number => n !== null && n >= 200)
    .sort((a, b) => a - b);
  if (!counts.length) return null;
  const mid = Math.floor(counts.length / 2);
  return counts.length % 2
    ? (counts[mid] ?? null)
    : Math.round(((counts[mid - 1] ?? 0) + (counts[mid] ?? 0)) / 2);
}
