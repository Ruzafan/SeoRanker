import { z } from 'zod';
import type { OutlineResult } from './outline.js';
import { composeSystemPrompt, type SiteContext } from './shared.js';

export const WRITE_PROMPT_VERSION = 'write@2';

export const writeSchema = z.object({
  contentHtml: z
    .string()
    .min(200)
    .describe(
      'The article body as clean HTML using only h2, h3, p, ul, ol, li, strong, em, a, table, thead, tbody, tr, th, td. Never h1.',
    ),
});
export type WriteResult = z.infer<typeof writeSchema>;

export const writeToolDescription = 'Submit the finished article body as HTML.';

export function writeSystem(site: SiteContext): string {
  return composeSystemPrompt(
    site,
    'You are an expert content writer. You write original, accurate, genuinely useful articles that read as written by a knowledgeable human, never as filler.',
  );
}

export interface InternalLink {
  title: string;
  url: string;
}

export interface ProductOption {
  id: number;
  name: string;
  url: string;
  price: string | null;
}

/** Marcador que el modelo pone en su propio párrafo; se sustituye por la tarjeta de producto. */
export const PRODUCT_MARKER = /\[\[product:(\d+)\]\]/g;

export function writeUser(input: {
  keyword: string;
  outline: Pick<OutlineResult, 'title' | 'sections' | 'faq'>;
  wordCount: number;
  links: InternalLink[];
  products?: ProductOption[];
}): string {
  const outline = input.outline.sections
    .map((s) => `## ${s.heading}\n${s.points.map((p) => `- ${p}`).join('\n')}`)
    .join('\n\n');
  const faq = input.outline.faq.map((f) => `- ${f.question}`).join('\n');
  const links = input.links.length
    ? input.links.map((l) => `- ${l.title}: ${l.url}`).join('\n')
    : '(none available)';
  const products = input.products ?? [];
  return [
    `Write the full article "${input.outline.title}" for the keyword "${input.keyword}".`,
    `Length: about ${input.wordCount} words.`,
    `Follow this outline (one h2 per section; use h3 only when it truly helps):\n${outline}`,
    `Finish with an FAQ section: an h2 heading, then each question as an h3 followed by its answer in one or two p paragraphs. Answer these questions:\n${faq}`,
    'HTML rules: use only h2, h3, p, ul, ol, li, strong, em, a, and table/thead/tbody/tr/th/td. Use a table only when comparing options across several attributes (a real comparison helps readers and earns rich results); keep tables small and put a sentence of context before them. Never use h1. No inline styles, classes, images or scripts. Do not repeat the title in the body. Do not add a wrapping <html> or <body>.',
    `Internal links: link naturally to relevant pages, choosing ONLY from this list and using the URLs exactly as written. Never invent or modify URLs; if nothing fits, add no link. Use 2-5 links at most.\n<available_links>\n${links}\n</available_links>`,
    products.length
      ? `Products from this store that you may recommend: where one of them genuinely helps the reader (not in every section), put a line containing only the marker [[product:ID]] as its own paragraph right after the text that recommends it, and a product card will be shown there. Feature at most 3, never the same one twice, and only if they truly fit the topic; if none fits, use no marker. Mention the product by name in the recommending sentence. Do not state prices or stock.\n<store_products>\n${products.map((p) => `- ID ${p.id}: ${p.name}${p.price ? ` (${p.price})` : ''}`).join('\n')}\n</store_products>`
      : '',
    'Write concrete, specific content. Avoid generic introductions and do not make up facts, statistics, prices or quotes.',
  ]
    .filter(Boolean)
    .join('\n\n');
}
