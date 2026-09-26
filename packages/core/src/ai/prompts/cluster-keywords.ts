import { z } from 'zod';
import { composeSystemPrompt, type SiteContext } from './shared.js';

export const CLUSTER_KEYWORDS_PROMPT_VERSION = 'cluster-keywords@1';

export const clusterKeywordsSchema = z.object({
  clusters: z.array(
    z.object({
      name: z.string().min(2).describe('Short topic name in the site language (2-5 words).'),
      pillar: z
        .string()
        .describe(
          'The broadest keyword of the cluster, exactly as given: it will become the comprehensive pillar guide.',
        ),
      keywords: z
        .array(z.string())
        .describe('Every keyword of this cluster, exactly as given (including the pillar).'),
    }),
  ),
});
export type ClusterKeywordsResult = z.infer<typeof clusterKeywordsSchema>;

export const clusterKeywordsToolDescription = 'Submit the topic clusters.';

export function clusterKeywordsSystem(site: SiteContext): string {
  return composeSystemPrompt(
    site,
    'You are an SEO strategist who organizes a site into topic clusters: one comprehensive pillar page per topic, supported by specific articles that link to it.',
  );
}

export function clusterKeywordsUser(keywords: string[]): string {
  return [
    'Group these keywords into topic clusters for the site. A cluster is a set of searches that belong to the same topic, so that one broad pillar article can link to specific supporting articles and vice versa.',
    'Rules: every keyword goes in exactly one cluster; aim for clusters of 3 to 15 keywords (a keyword that fits nowhere can be its own small cluster); the pillar must be the broadest keyword of its cluster and must be copied exactly as written; use the keywords exactly as given.',
    `<keywords>\n${keywords.map((k) => `- ${k}`).join('\n')}\n</keywords>`,
  ].join('\n\n');
}
