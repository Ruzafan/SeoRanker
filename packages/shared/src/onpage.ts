/**
 * Análisis on-page de un artículo (como el semáforo de Yoast). Función pura: la usa el editor en
 * vivo. Devuelve identificadores y valores; los textos los pone el frontend.
 */
export type OnPageCheckId =
  | 'keyword_in_title'
  | 'title_length'
  | 'meta_length'
  | 'keyword_in_meta'
  | 'keyword_in_slug'
  | 'keyword_in_intro'
  | 'keyword_in_h2'
  | 'keyword_density'
  | 'word_count'
  | 'h2_count'
  | 'internal_links'
  | 'faq_section'
  | 'sentence_length';

export type OnPageLevel = 'good' | 'warn' | 'bad';

export interface OnPageCheck {
  id: OnPageCheckId;
  level: OnPageLevel;
  /** Valor medido (longitud, porcentaje, número…) para mostrarlo en el mensaje. */
  value: number;
}

export interface OnPageInput {
  keyword: string | null;
  title: string;
  metaDescription: string | null;
  slug: string;
  html: string;
  /** Longitud objetivo configurada en el sitio. */
  targetWords: number;
}

export interface OnPageResult {
  /** 0-100: good = 1, warn = 0.5, bad = 0, promediado. */
  score: number;
  checks: OnPageCheck[];
}

const fold = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9ñ]+/g, ' ')
    .trim();

function textOf(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&[a-z]+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function countPhrase(haystack: string, phrase: string): number {
  if (!phrase) return 0;
  let n = 0;
  let i = ` ${haystack} `.indexOf(` ${phrase} `);
  const padded = ` ${haystack} `;
  while (i !== -1) {
    n++;
    i = padded.indexOf(` ${phrase} `, i + phrase.length + 1);
  }
  return n;
}

/** La keyword "cabe" en un texto si están todas sus palabras significativas (orden libre). */
function containsKeyword(text: string, keyword: string): boolean {
  const t = ` ${fold(text)} `;
  const words = fold(keyword)
    .split(' ')
    .filter((w) => w.length > 2);
  return words.length > 0 && words.every((w) => t.includes(` ${w} `) || t.includes(` ${w}s `));
}

const range = (v: number, good: [number, number], warn: [number, number]): OnPageLevel =>
  v >= good[0] && v <= good[1] ? 'good' : v >= warn[0] && v <= warn[1] ? 'warn' : 'bad';

export function analyzeOnPage(input: OnPageInput): OnPageResult {
  const kw = input.keyword?.trim() ?? '';
  const text = textOf(input.html);
  const words = text ? text.split(' ').length : 0;
  const folded = fold(text);
  const checks: OnPageCheck[] = [];
  const add = (id: OnPageCheckId, level: OnPageLevel, value: number) =>
    checks.push({ id, level, value });

  const meta = input.metaDescription?.trim() ?? '';
  const h2s = [...input.html.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi)].map((m) =>
    textOf(m[1] ?? ''),
  );
  const firstP = /<p[^>]*>([\s\S]*?)<\/p>/i.exec(input.html)?.[1] ?? '';
  const intro = textOf(firstP).split(' ').slice(0, 100).join(' ');
  const links = [...input.html.matchAll(/<a\s[^>]*href=/gi)].length;
  const sentences = text.split(/[.!?]+\s/).filter((s) => s.trim().split(' ').length > 2);
  const avgSentence = sentences.length ? words / sentences.length : 0;

  if (kw) {
    add('keyword_in_title', containsKeyword(input.title, kw) ? 'good' : 'bad', 0);
    add('keyword_in_meta', meta && containsKeyword(meta, kw) ? 'good' : 'warn', 0);
    add('keyword_in_slug', containsKeyword(input.slug.replace(/-/g, ' '), kw) ? 'good' : 'warn', 0);
    add('keyword_in_intro', containsKeyword(intro, kw) ? 'good' : 'warn', 0);
    add('keyword_in_h2', h2s.some((h) => containsKeyword(h, kw)) ? 'good' : 'warn', 0);
    const occurrences = countPhrase(folded, fold(kw));
    const density = words ? (occurrences * fold(kw).split(' ').length * 100) / words : 0;
    add('keyword_density', range(density, [0.4, 2.5], [0.1, 3.5]), Math.round(density * 10) / 10);
  }
  add('title_length', range(input.title.length, [30, 60], [20, 70]), input.title.length);
  add('meta_length', range(meta.length, [120, 158], [70, 170]), meta.length);
  add(
    'word_count',
    words >= input.targetWords * 0.85 ? 'good' : words >= input.targetWords * 0.6 ? 'warn' : 'bad',
    words,
  );
  add('h2_count', h2s.length >= 3 ? 'good' : h2s.length >= 2 ? 'warn' : 'bad', h2s.length);
  add('internal_links', range(links, [2, 8], [1, 15]), links);
  add('faq_section', /<h3/i.test(input.html) && h2s.length > 0 ? 'good' : 'warn', 0);
  add(
    'sentence_length',
    avgSentence <= 22 ? 'good' : avgSentence <= 28 ? 'warn' : 'bad',
    Math.round(avgSentence),
  );

  const points = checks.reduce(
    (n, c) => n + (c.level === 'good' ? 1 : c.level === 'warn' ? 0.5 : 0),
    0,
  );
  return { score: Math.round((points / checks.length) * 100), checks };
}
