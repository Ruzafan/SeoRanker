import { z } from 'zod';
import type { OutlineResult } from './outline.js';
import { composeSystemPrompt, type SiteContext } from './shared.js';

export const WRITE_PROMPT_VERSION = 'write@1';

export const writeSchema = z.object({
  contentHtml: z
    .string()
    .min(200)
    .describe(
      'The article body as clean HTML using only h2, h3, p, ul, ol, li, strong, em, a. Never h1.',
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

export function writeUser(input: {
  keyword: string;
  outline: Pick<OutlineResult, 'title' | 'sections' | 'faq'>;
  wordCount: number;
  links: InternalLink[];
}): string {
  const outline = input.outline.sections
    .map((s) => `## ${s.heading}\n${s.points.map((p) => `- ${p}`).join('\n')}`)
    .join('\n\n');
  const faq = input.outline.faq.map((f) => `- ${f.question}`).join('\n');
  const links = input.links.length
    ? input.links.map((l) => `- ${l.title}: ${l.url}`).join('\n')
    : '(none available)';
  return [
    `Write the full article "${input.outline.title}" for the keyword "${input.keyword}".`,
    `Length: about ${input.wordCount} words.`,
    `Follow this outline (one h2 per section; use h3 only when it truly helps):\n${outline}`,
    `Finish with an FAQ section (h2) answering:\n${faq}`,
    'HTML rules: use only h2, h3, p, ul, ol, li, strong, em and a. Never use h1. No inline styles, classes, images, tables or scripts. Do not repeat the title in the body. Do not add a wrapping <html> or <body>.',
    `Internal links: link naturally to relevant pages, choosing ONLY from this list and using the URLs exactly as written. Never invent or modify URLs; if nothing fits, add no link. Use 2-5 links at most.\n<available_links>\n${links}\n</available_links>`,
    'Write concrete, specific content. Avoid generic introductions and do not make up facts, statistics, prices or quotes.',
  ].join('\n\n');
}
