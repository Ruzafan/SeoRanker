import type { Site } from '@seo/db';
import { AppError } from '../errors.js';
import {
  seedKeywordsSchema,
  seedKeywordsSystem,
  seedKeywordsToolDescription,
  seedKeywordsUser,
} from '../ai/prompts/seed-keywords.js';
import { normalizeTerm } from '../keywords/provider.js';
import { adapterFor, modelFor, siteContext } from './common.js';
import type { PipelineContext } from './context.js';
import type { UsageTracker } from './usage.js';

const CONTENT_LIMIT = 90;
const CATEGORY_LIMIT = 50;
const MAX_SEEDS = 15;

/**
 * Deduce las seeds a partir del contenido publicado de la tienda (categorías y títulos).
 * Lanza NO_SEEDS si la tienda no tiene nada de lo que deducirlas.
 */
export async function generateSeeds(
  ctx: PipelineContext,
  site: Site,
  tracker: UsageTracker,
): Promise<string[]> {
  const adapter = adapterFor(ctx, site);
  const [content, categories] = await Promise.all([
    adapter.listContent(CONTENT_LIMIT),
    adapter.listCategories(CATEGORY_LIMIT),
  ]);
  if (content.length === 0 && categories.length === 0) {
    throw new AppError('NO_SEEDS', 'No seeds configured and no published content to derive them', {
      httpStatus: 400,
    });
  }

  const result = await ctx.claude.callTool({
    model: modelFor(ctx, site),
    system: seedKeywordsSystem(siteContext(site)),
    user: seedKeywordsUser({ categories, content }),
    maxTokens: 2000,
    toolDescription: seedKeywordsToolDescription,
    schema: seedKeywordsSchema,
  });
  await tracker.add(result.model, result.usage);

  const seeds = [...new Set(result.data.seeds.map((s) => normalizeTerm(s.term)))]
    .filter((s) => s.length >= 2 && s.length <= 100)
    .slice(0, MAX_SEEDS);
  if (seeds.length === 0) {
    throw new AppError('NO_SEEDS', 'Could not derive seeds from the site content', {
      httpStatus: 400,
    });
  }
  return seeds;
}
