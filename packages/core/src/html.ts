import sanitizeHtml from 'sanitize-html';

const ALLOWED_TAGS = [
  'h2',
  'h3',
  'p',
  'ul',
  'ol',
  'li',
  'strong',
  'em',
  'a',
  'blockquote',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
];

/**
 * Sanea HTML generado por el modelo: lista blanca de etiquetas, sin h1, solo href en enlaces.
 * Si se pasa `allowedLinks`, los enlaces a cualquier otra URL se sustituyen por su texto.
 */
export function sanitizeArticleHtml(html: string, allowedLinks?: ReadonlySet<string>): string {
  const first = sanitizeHtml(html, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: { a: ['href'] },
    allowedSchemes: ['http', 'https'],
    allowProtocolRelative: false,
    transformTags: { h1: 'h2' },
  });
  if (!allowedLinks) return first.trim();
  return sanitizeHtml(first, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: { a: ['href'] },
    transformTags: {
      a: (tagName, attribs) => {
        const href = attribs['href'];
        return href && allowedLinks.has(href)
          ? { tagName, attribs: { href } }
          : { tagName: 'span', attribs: {} as Record<string, string> };
      },
    },
  }).trim();
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  hellip: '…',
  ndash: '–',
  mdash: '—',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e.startsWith('#x') || e.startsWith('#X'))
      return String.fromCodePoint(parseInt(e.slice(2), 16));
    if (e.startsWith('#')) return String.fromCodePoint(parseInt(e.slice(1), 10));
    return NAMED_ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Texto plano de un HTML: sin etiquetas, con entidades decodificadas y espacios colapsados. */
export function stripHtml(html: string): string {
  const noTags = sanitizeHtml(html.replace(/</g, ' <'), { allowedTags: [], allowedAttributes: {} });
  return decodeEntities(noTags).replace(/\s+/g, ' ').trim();
}

export function countWords(html: string): number {
  const text = stripHtml(html);
  return text ? text.split(' ').length : 0;
}

/** Extrae los href de un HTML ya saneado. */
export function extractLinks(html: string): string[] {
  return [...html.matchAll(/<a\s+href="([^"]+)"/g)].map((m) => m[1] ?? '').filter(Boolean);
}

export function truncateAtWord(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[\s,;:.-]+$/, '');
}

export function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
}

/** Sustituye los marcadores [[product:ID]] por el shortcode de WooCommerce; los ID no ofrecidos se quitan. */
export function applyProductCards(
  html: string,
  allowedIds: ReadonlySet<number>,
): { html: string; productIds: number[] } {
  const used: number[] = [];
  const out = html
    .replace(/<p>\s*\[\[product:(\d+)\]\]\s*<\/p>/g, (_m, id: string) => {
      const n = Number(id);
      if (!allowedIds.has(n) || used.includes(n)) return '';
      used.push(n);
      // Shortcode nativo de WooCommerce: precio, stock y botón de compra siempre al día.
      return `\n[products ids="${n}" columns="1"]\n`;
    })
    .replace(/\[\[product:\d+\]\]/g, '');
  return { html: out.trim(), productIds: used };
}

/** stripHtml deja un espacio donde había etiquetas ("tibia </strong>." → "tibia ."). */
const tidy = (text: string): string => text.replace(/\s+([.,;:!?)»])/g, '$1');

export interface FaqItem {
  question: string;
  answer: string;
}

/**
 * Preguntas frecuentes tal y como se ven en el artículo: la última sección h2 cuyo contenido son
 * pares h3 + párrafos. El JSON-LD debe reflejar el contenido visible, no el esquema previo.
 */
export function extractFaq(html: string): FaqItem[] {
  const sections = html.split(/<h2>/i);
  const last = sections.at(-1) ?? '';
  const parts = last.split(/<h3>/i).slice(1);
  return parts
    .map((part) => {
      const [q = '', rest = ''] = part.split(/<\/h3>/i);
      return {
        question: tidy(stripHtml(q)),
        answer: tidy(stripHtml(rest.replace(/\[products[^\]]*\]/g, ''))),
      };
    })
    .filter((f) => f.question.length > 3 && f.answer.length > 10);
}
