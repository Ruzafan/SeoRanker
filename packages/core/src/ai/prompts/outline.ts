import { z } from 'zod';
import type { SerpSnapshot } from '../../keywords/serp.js';
import { composeSystemPrompt, type SiteContext } from './shared.js';

export const OUTLINE_PROMPT_VERSION = 'outline@2';

export const outlineSchema = z.object({
  title: z
    .string()
    .min(5)
    .describe('SEO title, ideally under 60 characters, includes the keyword.'),
  slug: z.string().min(2).describe('URL slug: lowercase ascii, words separated by hyphens.'),
  metaDescription: z
    .string()
    .min(20)
    .describe(
      'Meta description, ideally 140-155 characters, includes the keyword and a reason to click.',
    ),
  sections: z
    .array(
      z.object({
        heading: z.string().min(2).describe('H2 heading.'),
        points: z.array(z.string().min(2)).min(1).describe('What this section must cover.'),
      }),
    )
    .min(3),
  faq: z
    .array(z.object({ question: z.string().min(5), answer: z.string().min(10) }))
    .describe('3-5 frequently asked questions with concise answers.'),
});
export type OutlineResult = z.infer<typeof outlineSchema>;

export const outlineToolDescription = 'Submit the article outline.';

export function outlineSystem(site: SiteContext): string {
  return composeSystemPrompt(
    site,
    'You are an expert SEO content strategist who plans articles that satisfy search intent better than the current results.',
  );
}

/** Resumen compacto de la SERP para el prompt: títulos, estructura y longitud de la competencia. */
export function describeSerp(serp: SerpSnapshot, medianWords: number | null): string {
  const results = serp.results
    .map((r) => {
      const meta = r.wordCount ? ` (~${r.wordCount} words)` : '';
      const headings = r.headings.length
        ? `\n   Headings:\n${r.headings.map((h) => `   - ${h.trim()}`).join('\n')}`
        : '';
      return `${r.position}. ${r.title} — ${r.url}${meta}\n   ${r.snippet}${headings}`;
    })
    .join('\n');
  return [
    `<current_google_results>\n${results}\n</current_google_results>`,
    serp.relatedQuestions.length
      ? `People also ask on Google:\n${serp.relatedQuestions.map((q) => `- ${q}`).join('\n')}`
      : '',
    serp.features.length ? `Search result features present: ${serp.features.join(', ')}.` : '',
    medianWords ? `Median length of the top results: about ${medianWords} words.` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

export function outlineUser(input: {
  keyword: string;
  intent: string | null;
  wordCount: number;
  serp?: { snapshot: SerpSnapshot; medianWords: number | null } | null;
}): string {
  return [
    `Plan an article targeting the keyword: "${input.keyword}"${input.intent ? ` (search intent: ${input.intent})` : ''}.`,
    `Target length: about ${input.wordCount} words. Plan sections so the total fits that length.`,
    input.serp
      ? `This is what currently ranks on Google for this keyword. Study it: your outline must cover every subtopic that several top results agree on (that is what Google considers essential for this intent), and then add something they lack (a comparison, a clear step-by-step, a decision guide, specific examples). Never copy their wording or structure literally. Use the "People also ask" questions for the FAQ when relevant. Their format tells you what the searcher wants (e.g. lists and comparisons, or a tutorial).\n\n${describeSerp(input.serp.snapshot, input.serp.medianWords)}`
      : '',
    'Requirements: the title and meta description must contain the keyword naturally; sections must follow a logical order that answers the reader\'s intent quickly; the FAQ must reflect real follow-up questions. Do not include an H1 (the title is the H1) and do not plan a "Conclusion" section that only repeats the article.',
  ]
    .filter(Boolean)
    .join('\n\n');
}
