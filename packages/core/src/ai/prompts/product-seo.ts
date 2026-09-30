import { z } from 'zod';
import { META_DESCRIPTION_MAX, SEO_TITLE_MAX, plainText, type ProductSnapshot } from '@seo/shared';
import { composeSystemPrompt, type SiteContext } from './shared.js';

export const PRODUCT_SEO_PROMPT_VERSION = 'product-seo@1';

const proposal = (what: string) =>
  z
    .object({
      value: z.string().describe(`${what} Empty string = leave the current value as it is.`),
      reason: z
        .string()
        .describe(
          'One short sentence for the shop owner: why this helps. Empty if value is empty.',
        ),
    })
    .describe(what);

export const productSeoSchema = z.object({
  focusKeyword: proposal(
    'Focus keyword: the search (2-5 words, lowercase) a buyer would type in Google to find this exact product.',
  ),
  seoTitle: proposal(
    `SEO title shown in Google, at most ${SEO_TITLE_MAX} characters, with the focus keyword near the start.`,
  ),
  metaDescription: proposal(
    `Meta description, 120-${META_DESCRIPTION_MAX - 5} characters: what it is, the key benefit and a soft call to action.`,
  ),
  shortDescription: proposal(
    'Short description shown next to the price: plain text, 1-3 sentences summarising the product with facts from its description. REQUIRED when the current short description is empty; empty string when one already exists.',
  ),
  tagsToAdd: z
    .array(z.string())
    .describe(
      'Up to 5 NEW product tags (lowercase, 1-3 words, no commas) that shoppers would browse by. Never repeat existing tags. Empty array if the current tags are enough.',
    ),
  tagsReason: z.string().describe('One short sentence: why these tags. Empty if none.'),
  imageAlts: z
    .array(z.object({ imageId: z.number().int(), alt: z.string() }))
    .describe(
      'Alt text ONLY for the images listed as having no alt text: describe what is visible (product name, color, view), max 120 characters, without "image of".',
    ),
});
export type ProductSeoResult = z.infer<typeof productSeoSchema>;

export const productSeoToolDescription = 'Submit the SEO proposals for this product.';

export function productSeoSystem(site: SiteContext): string {
  return composeSystemPrompt(
    site,
    'You are an e-commerce SEO specialist who improves product pages without changing what the shop owner already did well.',
  );
}

export function productSeoUser(p: ProductSnapshot, keywords: string[]): string {
  const field = (label: string, value: string) =>
    `${label}: ${value.trim() ? value.trim() : '(empty)'}`;
  const images = p.images.map(
    (i) => `- image ${i.id}: ${i.alt.trim() ? `alt "${i.alt.trim()}"` : 'NO ALT TEXT'}`,
  );
  // Lo vacío se nombra explícitamente: si no, una voz de marca del tipo "un párrafo por producto"
  // lleva a Claude a dar por buena la descripción larga y dejar la corta sin rellenar.
  const seo = p.seoPlugin !== null;
  const empty = [
    seo && !p.focusKeyword.trim() && 'focusKeyword',
    seo && !p.seoTitle.trim() && 'seoTitle',
    seo && !p.metaDescription.trim() && 'metaDescription',
    !plainText(p.shortDescription) &&
      'shortDescription (the short description is empty; the long description does not replace it)',
    p.images.some((i) => !i.alt.trim()) && 'imageAlts (for every image without alt text)',
  ].filter(Boolean);
  return [
    'Review the SEO of this product page and propose changes.',
    empty.length
      ? `These fields are EMPTY and you MUST propose a value for each:\n${empty.map((f) => `- ${f}`).join('\n')}`
      : '',
    'Rules:',
    '- Use ONLY facts present in the product data below. Never invent materials, sizes, compatibility, prices, shipping or guarantees.',
    '- For fields that are empty, propose a value.',
    '- For fields that already have a value, propose a new one ONLY if it is clearly better for search (missing the keyword, too long or too short, vague, duplicated from the title). If the current value is fine, return an empty value: fewer, better proposals are preferred.',
    '- Never propose a focus keyword or short description when one already exists.',
    '- Keep the tone of the existing texts.',
    keywords.length
      ? `Searches this store already targets (use them when they fit this product):\n${keywords.map((k) => `- ${k}`).join('\n')}`
      : '',
    [
      '<product>',
      field('Name', p.name),
      field('Price', p.price ?? ''),
      field('Categories', p.categories.join(', ')),
      field('Tags', p.tags.join(', ')),
      field('Short description', plainText(p.shortDescription)),
      field('Description', p.description),
      field('Focus keyword', p.focusKeyword),
      field('SEO title', p.seoTitle),
      field('Meta description', p.metaDescription),
      `Images:\n${images.join('\n') || '(none)'}`,
      '</product>',
    ].join('\n'),
  ]
    .filter(Boolean)
    .join('\n\n');
}
