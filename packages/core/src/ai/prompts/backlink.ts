import { z } from 'zod';
import { composeSystemPrompt, type SiteContext } from './shared.js';

export const BACKLINK_PROMPT_VERSION = 'backlink@1';

export const backlinkSchema = z.object({
  paragraphIndex: z
    .number()
    .describe('Index of the paragraph that gets the link, or -1 if no paragraph fits naturally.'),
  paragraphHtml: z
    .string()
    .describe(
      'That paragraph rewritten with the new link. Empty string when paragraphIndex is -1.',
    ),
  anchorText: z.string().describe('The anchor text used. Empty string when paragraphIndex is -1.'),
});
export type BacklinkResult = z.infer<typeof backlinkSchema>;

export const backlinkToolDescription = 'Submit the paragraph that receives the internal link.';

export function backlinkSystem(site: SiteContext): string {
  return composeSystemPrompt(
    site,
    'You are a careful editor who adds internal links to existing articles without changing their meaning or style.',
  );
}

export function backlinkUser(input: {
  target: { title: string; url: string; keyword: string | null };
  paragraphs: { index: number; html: string }[];
}): string {
  return [
    `A new article has been published: "${input.target.title}"${input.target.keyword ? ` (about "${input.target.keyword}")` : ''} at ${input.target.url}.`,
    'Add ONE internal link to it inside the existing article below. Choose the single paragraph where a reader would genuinely want to follow that link. Rewrite only that paragraph, changing as little as possible: keep every sentence, every existing link and the tone; at most add or adjust a few words so the link reads naturally.',
    `The link must be exactly <a href="${input.target.url}">descriptive anchor</a>, with a descriptive anchor of 2 to 6 words about the new article (never "click here"). Output the full paragraph as HTML starting with <p> and ending with </p>. If no paragraph fits naturally, return paragraphIndex -1.`,
    `<paragraphs>\n${input.paragraphs.map((p) => `[${p.index}] ${p.html}`).join('\n')}\n</paragraphs>`,
  ].join('\n\n');
}
