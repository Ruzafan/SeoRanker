/**
 * Similitud entre búsquedas para evitar canibalización: dos artículos que atacan la misma
 * intención compiten entre sí en Google. Léxica y determinista (sin coste): palabras significativas
 * sin acentos, sin palabras vacías y con un stemming mínimo (plurales).
 */
const STOPWORDS = new Set(
  // es
  (
    'de la el los las un una unos unas y o u a al del en con por para sin sobre que como cual cuales cuando donde mas muy su sus tu tus mi mis es son se lo le les ya hay ' +
    // en
    'the a an of to in on for with and or is are be how what which why best vs your my ' +
    // fr / pt / it / de (lo más frecuente)
    'le les des du et ou pour avec dans une un est o os as do da dos das e para com il lo gli di per con che der die das und oder mit fur ein eine'
  ).split(' '),
);

/**
 * Stemming mínimo y consistente: sin "s" final y después sin "e" final, así
 * clase/clases, color/colores y figura/figuras acaban igual.
 */
function stem(word: string): string {
  let w = word;
  if (w.length > 3 && w.endsWith('s')) w = w.slice(0, -1);
  if (w.length > 3 && w.endsWith('e')) w = w.slice(0, -1);
  return w;
}

export function tokens(text: string): Set<string> {
  return new Set(
    text
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .split(/[^a-z0-9ñ]+/)
      .filter((w) => w.length > 1 && !STOPWORDS.has(w))
      .map(stem),
  );
}

/** Jaccard de palabras significativas (0-1). */
export function similarity(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / (ta.size + tb.size - inter);
}

/** Umbral a partir del cual dos búsquedas se consideran la misma intención. */
export const CANNIBAL_THRESHOLD = 0.75;

/**
 * La misma intención: casi las mismas palabras significativas (Jaccard ≥ 0,75), o una contenida
 * en la otra con como mucho una palabra de diferencia ("figuras resina" ⊂ "figuras de resina baratas").
 */
export function sameIntent(a: string, b: string): boolean {
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.size || !tb.size) return false;
  if (similarity(a, b) >= CANNIBAL_THRESHOLD) return true;
  const [small, big] = ta.size <= tb.size ? [ta, tb] : [tb, ta];
  if (small.size < 2) return false;
  for (const t of small) if (!big.has(t)) return false;
  return big.size - small.size <= 1;
}

export interface Target {
  id: string;
  texts: string[];
}

/** Primer destino (artículo) que ataca la misma intención que `term`, o null. */
export function findCannibal(term: string, targets: Target[]): Target | null {
  return targets.find((t) => t.texts.some((x) => sameIntent(term, x))) ?? null;
}

/**
 * Deduplica candidatos casi idénticos: se queda con el de mayor puntuación de cada grupo.
 * O(n²) sobre lotes pequeños (≤ 60 por lote de discover).
 */
export function dedupeSimilar<T extends { term: string; score: number }>(items: T[]): T[] {
  const kept: T[] = [];
  for (const item of [...items].sort((a, b) => b.score - a.score)) {
    if (!kept.some((k) => sameIntent(k.term, item.term))) kept.push(item);
  }
  return kept;
}
