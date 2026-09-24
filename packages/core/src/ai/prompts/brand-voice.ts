import { z } from 'zod';
import type { ContentSample } from '../../adapters/index.js';
import { composeSystemPrompt, type SiteContext } from './shared.js';

export const BRAND_VOICE_PROMPT_VERSION = 'brand-voice@1';

export const brandVoiceSchema = z.object({
  profile: z
    .string()
    .min(200)
    .describe('Brand voice profile in Markdown, written in the site language.'),
});
export type BrandVoiceResult = z.infer<typeof brandVoiceSchema>;

export const brandVoiceToolDescription =
  'Submit the brand voice profile derived from the sample content.';

export function brandVoiceSystem(site: SiteContext): string {
  return composeSystemPrompt(
    { ...site, brandVoice: null },
    'You are a senior brand strategist and editor who reverse-engineers writing style from existing content.',
  );
}

export function brandVoiceUser(samples: ContentSample[]): string {
  const body = samples
    .map(
      (s, i) =>
        `<sample index="${i + 1}" type="${s.type}">\n# ${s.title}\n${s.body.slice(0, 2500)}\n</sample>`,
    )
    .join('\n\n');
  return [
    'Analyse the following published pages and write a reusable brand voice profile that a copywriter could follow to write new articles indistinguishable from these.',
    "Cover, in this order, as short Markdown sections: Audience; Tone and personality; Vocabulary (preferred and avoided terms, jargon level); Sentence and paragraph rhythm; Point of view and how the reader is addressed; Structure habits (openers, headings, calls to action); Do and Don't list (5 each).",
    'Base every claim on evidence in the samples. Do not invent products or facts. Keep it under 500 words.',
    body,
  ].join('\n\n');
}
