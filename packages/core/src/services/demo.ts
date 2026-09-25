import type { DemoResultDto } from '@seo/shared';
import { AppError } from '../errors.js';
import { stripHtml } from '../html.js';
import {
  AutocompleteProvider,
  defaultHttpDeps,
  normalizeTerm,
  questionModifiers,
} from '../keywords/provider.js';
import { assertPublicDestination, normalizeSiteUrl } from '../url.js';

export interface DemoDeps {
  fetchFn?: typeof fetch | undefined;
  allowPrivateHosts: boolean;
  /** Para tests: sin esperas entre peticiones a Autocomplete. */
  sleep?: (ms: number) => Promise<void>;
}

const MAX_TOPICS = 3;
const MAX_KEYWORDS = 12;
const CACHE_MS = 24 * 3_600_000;
const cache = new Map<string, { at: number; result: DemoResultDto }>();

/**
 * Demo pública de la landing: con solo la URL de la tienda, deduce sus temas (categorías públicas
 * de WordPress/WooCommerce o, si no, los encabezados de la portada) y busca en Google Autocomplete
 * lo que preguntan sus clientes. Sin credenciales, sin IA (coste cero) y cacheado 24 h por dominio.
 */
export async function runDemo(
  deps: DemoDeps,
  rawUrl: string,
  language = 'es',
  country = 'ES',
): Promise<DemoResultDto> {
  const url = normalizeSiteUrl(rawUrl, { allowPrivate: deps.allowPrivateHosts });
  const host = new URL(url).hostname;
  const hit = cache.get(`${host}|${language}|${country}`);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.result;

  const fetchFn = deps.fetchFn ?? fetch;
  const get = async (target: string): Promise<Response | null> => {
    try {
      if (!deps.allowPrivateHosts) await assertPublicDestination(target);
      const res = await fetchFn(target, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SEOAutopilot/1.0)' },
        signal: AbortSignal.timeout(8_000),
      });
      return res.ok ? res : null;
    } catch {
      return null;
    }
  };

  let siteName: string | null = null;
  let platform: DemoResultDto['platform'] = 'unknown';
  let topics: string[] = [];

  // 1. WordPress/WooCommerce: categorías públicas, las más usadas primero.
  for (const taxonomy of ['product_cat', 'categories']) {
    const res = await get(
      `${url}/wp-json/wp/v2/${taxonomy}?per_page=20&orderby=count&order=desc&hide_empty=true&_fields=name,slug`,
    );
    if (!res) continue;
    const terms = (await res.json().catch(() => [])) as { name?: string; slug?: string }[];
    if (!Array.isArray(terms)) continue;
    platform = taxonomy === 'product_cat' ? 'woocommerce' : 'wordpress';
    topics = terms
      .filter((t) => t.slug !== 'uncategorized' && t.slug !== 'sin-categoria')
      .map((t) => stripHtml(t.name ?? '').toLowerCase())
      .filter((t) => t.length >= 3);
    if (topics.length) break;
  }

  // 2. Cualquier web: título y encabezados de la portada.
  const home = await get(url);
  if (home) {
    const html = (await home.text()).slice(0, 800_000);
    siteName =
      stripHtml(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '')
        .split(/[|–—-]/)[0]
        ?.trim() || null;
    if (!topics.length) {
      topics = [...html.matchAll(/<(h1|h2)\b[^>]*>([\s\S]*?)<\/\1>/gi)]
        .map((m) => stripHtml(m[2] ?? '').toLowerCase())
        .filter((t) => t.length >= 4 && t.length <= 40 && t.split(' ').length <= 4);
    }
  } else if (platform === 'unknown') {
    throw new AppError('CONNECTION_FAILED', `Could not reach ${host}`, { httpStatus: 400 });
  }
  topics = [...new Set(topics)].slice(0, MAX_TOPICS);
  if (!topics.length) {
    throw new AppError('NO_SEEDS', 'No topics could be derived from the site', { httpStatus: 422 });
  }

  // 3. Lo que busca la gente: preguntas de Autocomplete sobre cada tema.
  const provider = new AutocompleteProvider({
    ...defaultHttpDeps,
    fetchFn: deps.fetchFn ?? defaultHttpDeps.fetchFn,
    sleep: deps.sleep ?? defaultHttpDeps.sleep,
  });
  const modifiers = questionModifiers(language).slice(0, 4);
  const found = new Map<string, string>();
  await Promise.all(
    topics.map(async (topic) => {
      for (const q of [topic, ...modifiers.map((m) => `${m} ${topic}`)]) {
        const suggestions = await provider.suggestions(q, { language, country }).catch(() => []);
        for (const s of suggestions) {
          const term = normalizeTerm(s);
          if (term.includes(' ') && term !== topic && !found.has(term)) found.set(term, topic);
        }
      }
    }),
  );
  // Primero las preguntas (dan artículos), después el resto; repartidas entre temas.
  // Google devuelve a menudo las preguntas sin tilde ("como" en vez de "cómo").
  const bare = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const questionWords = questionModifiers(language).map(bare);
  const isQuestion = (t: string) => questionWords.some((m) => bare(t).startsWith(`${m} `));
  const keywords = [...found.entries()]
    .sort(([a], [b]) => Number(isQuestion(b)) - Number(isQuestion(a)))
    .slice(0, MAX_KEYWORDS)
    .map(([term, topic]) => ({ term, topic, question: isQuestion(term) }));

  const result: DemoResultDto = { url, siteName, platform, topics, keywords };
  cache.set(`${host}|${language}|${country}`, { at: Date.now(), result });
  return result;
}

/** Solo para tests. */
export function clearDemoCache(): void {
  cache.clear();
}
