import { z } from 'zod';
import type { ContentItem } from '../../adapters/index.js';
import { composeSystemPrompt, type SiteContext } from './shared.js';

export const SEED_KEYWORDS_PROMPT_VERSION = 'seed-keywords@1';

export const seedKeywordsSchema = z.object({
  seeds: z
    .array(
      z.object({
        term: z
          .string()
          .min(2)
          .max(100)
          .describe('Short head keyword (1-4 words), lowercase, as people type it in Google.'),
        reason: z.string().describe('One short sentence: which part of the store it covers.'),
      }),
    )
    .min(3)
    .describe('8-15 seed keywords covering the main product lines and topics of the store.'),
});
export type SeedKeywordsResult = z.infer<typeof seedKeywordsSchema>;

export const seedKeywordsToolDescription = 'Submit the seed keywords that describe the store.';

export function seedKeywordsSystem(site: SiteContext): string {
  return composeSystemPrompt(
    site,
    'You are an SEO strategist who maps an online store to the searches its customers make.',
  );
}

export function seedKeywordsUser(input: { categories: string[]; content: ContentItem[] }): string {
  const byType = (type: string) =>
    input.content.filter((c) => c.type === type).map((c) => `- ${c.title}`);
  const block = (tag: string, lines: string[]) =>
    lines.length ? `<${tag}>\n${lines.join('\n')}\n</${tag}>` : '';
  return [
    'Below is an inventory of the store: its categories and the titles of its products, pages and posts.',
    'Propose the seed keywords this store should build its content strategy on. Each seed is a short, generic search (1-4 words) that the store could rank for with helpful articles, and that will later be expanded with autocomplete. Cover every main product line; prefer terms with real search demand over internal names, SKUs or brand-specific model names. Do not include the store name, competitors or navigational queries.',
    block(
      'categories',
      input.categories.map((c) => `- ${c}`),
    ),
    block('products', byType('product')),
    block('pages', byType('page')),
    block('posts', byType('post')),
  ]
    .filter(Boolean)
    .join('\n\n');
}
