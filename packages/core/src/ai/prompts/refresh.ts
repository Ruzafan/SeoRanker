import { z } from 'zod';
import type { SerpSnapshot } from '../../keywords/serp.js';
import { describeSerp } from './outline.js';
import { composeSystemPrompt, type SiteContext } from './shared.js';

export const REFRESH_PROMPT_VERSION = 'refresh@1';

export const refreshSchema = z.object({
  contentHtml: z
    .string()
    .min(200)
    .describe('The full updated article body as clean HTML (same rules as the original).'),
  changes: z
    .array(z.string())
    .describe('What you changed and why, in the site language, 2-6 short bullet points.'),
});
export type RefreshResult = z.infer<typeof refreshSchema>;

export const refreshToolDescription = 'Submit the refreshed article body.';

export function refreshSystem(site: SiteContext): string {
  return composeSystemPrompt(
    site,
    'You are an expert SEO editor who updates existing articles so they win back rankings, improving them without changing their topic or URL.',
  );
}

export interface PageQuery {
  query: string;
  impressions: number;
  clicks: number;
  position: number;
}

export function refreshUser(input: {
  keyword: string;
  title: string;
  html: string;
  wordCount: number;
  serp: { snapshot: SerpSnapshot; medianWords: number | null } | null;
  queries: PageQuery[];
}): string {
  return [
    `This published article targets "${input.keyword}" and is losing Google traffic. Update it so it deserves to rank again. Title (unchanged): "${input.title}".`,
    input.queries.length
      ? `Real Google searches this page already appears for (last 28 days). Make sure the article answers them explicitly, especially those with many impressions and a position beyond 5 (add a section, a paragraph or an FAQ entry as appropriate):\n${input.queries.map((q) => `- "${q.query}": ${q.impressions} impressions, ${q.clicks} clicks, position ${q.position.toFixed(1)}`).join('\n')}`
      : '',
    input.serp
      ? `What ranks today for the keyword. Cover the subtopics the top results agree on that the article lacks; never copy them:\n\n${describeSerp(input.serp.snapshot, input.serp.medianWords)}`
      : '',
    `Rules: keep what already works (structure, voice, accurate content); fix or remove anything outdated; keep every existing internal link (same URLs) and keep every line with a [products ...] shortcode exactly as it is; do not invent facts, statistics, prices or quotes. Length: at least ${input.wordCount} words. HTML: only h2, h3, p, ul, ol, li, strong, em, a, and table/thead/tbody/tr/th/td; never h1; FAQ as the last h2 section with each question as an h3.`,
    `<current_article>\n${input.html}\n</current_article>`,
  ]
    .filter(Boolean)
    .join('\n\n');
}
