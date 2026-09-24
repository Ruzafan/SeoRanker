import { z } from 'zod';
import { composeSystemPrompt, type SiteContext } from './shared.js';

export const SCORE_KEYWORDS_PROMPT_VERSION = 'score-keywords@1';

export const scoreKeywordsSchema = z.object({
  keywords: z.array(
    z.object({
      term: z.string().describe('The candidate exactly as provided.'),
      keep: z.boolean().describe('false for noise, unrelated topics, or other brands.'),
      // Tolerante a propósito: un valor raro en UNA keyword no debe tirar el lote entero.
      // Se normaliza (clamp / valores válidos) en normalizeScore().
      score: z.number().describe('Opportunity for this site, an integer from 0 to 100.'),
      intent: z
        .string()
        .describe('Exactly one of: "informational", "commercial", "transactional".'),
    }),
  ),
});
export type ScoreKeywordsResult = z.infer<typeof scoreKeywordsSchema>;

const INTENTS = ['informational', 'commercial', 'transactional'] as const;

export function normalizeScore(
  score: number,
  intent: string,
): { score: number; intent: string | null } {
  const clean = Number.isFinite(score) ? Math.min(100, Math.max(0, Math.round(score))) : 0;
  const i = intent.trim().toLowerCase();
  return { score: clean, intent: (INTENTS as readonly string[]).includes(i) ? i : null };
}

export const scoreKeywordsToolDescription = 'Submit the evaluation of every candidate keyword.';

export function scoreKeywordsSystem(site: SiteContext): string {
  return composeSystemPrompt(
    site,
    'You are an SEO strategist who selects keywords worth writing articles for.',
  );
}

export function scoreKeywordsUser(seeds: string[], candidates: string[]): string {
  return [
    `The site's niche is described by these seed keywords: ${seeds.map((s) => `"${s}"`).join(', ')}.`,
    'Evaluate every candidate below. Set keep=false for: gibberish or typos, topics unrelated to the niche, navigational queries for other brands or competitors, and queries that cannot be answered by a helpful article. For the rest, score 0-100 by how valuable an article would be for this site (relevance to the niche, likely search demand, realistic ability to rank, commercial value) and classify the search intent.',
    'Return one entry per candidate, using the candidate text exactly as given.',
    `<candidates>\n${candidates.map((c) => `- ${c}`).join('\n')}\n</candidates>`,
  ].join('\n\n');
}
