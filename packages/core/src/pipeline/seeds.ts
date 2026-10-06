import type { Site } from '@seo/db';
import { parseSettings } from '@seo/shared';
import { AppError } from '../errors.js';
import {
  seedKeywordsSchema,
  seedKeywordsSystem,
  seedKeywordsToolDescription,
  seedKeywordsUser,
} from '../ai/prompts/seed-keywords.js';
import { normalizeTerm } from '../keywords/provider.js';
import { loadSite, modelFor, readerFor, siteContext } from './common.js';
import type { PipelineContext, RunInfo } from './context.js';
import { runTracked } from './run-tracked.js';
import type { UsageTracker } from './usage.js';

const CONTENT_LIMIT = 90;
const CATEGORY_LIMIT = 50;
const MAX_SEEDS = 15;
/** Tope de `settings.seeds` (schema de ajustes). */
const MAX_SITE_SEEDS = 50;

/**
 * Deduce las seeds a partir del contenido publicado de la tienda (categorías y títulos).
 * Con `existing`, pide seeds que las complementen. Lanza NO_SEEDS si no sale ninguna.
 */
export async function generateSeeds(
  ctx: PipelineContext,
  site: Site,
  tracker: UsageTracker,
  existing: string[] = [],
): Promise<string[]> {
  const adapter = readerFor(ctx, site);
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
    user: seedKeywordsUser({ categories, content, existing }),
    maxTokens: 2000,
    toolDescription: seedKeywordsToolDescription,
    schema: seedKeywordsSchema,
  });
  await tracker.add(result.model, result.usage);

  const seeds = [...new Set(result.data.seeds.map((s) => normalizeTerm(s.term)))]
    .filter((s) => s.length >= 2 && s.length <= 100 && !existing.includes(s))
    .slice(0, MAX_SEEDS);
  if (seeds.length === 0) {
    throw new AppError('NO_SEEDS', 'Could not derive seeds from the site content', {
      httpStatus: 400,
    });
  }
  return seeds;
}

/** Botón «Sugerir desde mi tienda»: añade seeds nuevas a las que ya hay, sin descubrir keywords. */
export function runSeeds(ctx: PipelineContext, info: RunInfo): Promise<void> {
  return runTracked(ctx, info, async (tracker) => {
    const site = await loadSite(ctx, info.siteId);
    const existing = parseSettings(site.settings).seeds.map(normalizeTerm);
    const suggested = await generateSeeds(ctx, site, tracker, existing);
    // Se releen los ajustes: el usuario pudo guardarlos mientras Claude pensaba.
    const latest = parseSettings((await loadSite(ctx, site.id)).settings);
    const seeds = [...new Set([...latest.seeds, ...suggested])].slice(0, MAX_SITE_SEEDS);
    await ctx.prisma.site.update({
      where: { id: site.id },
      data: { settings: { ...latest, seeds } },
    });
    return {
      meta: { added: seeds.length - latest.seeds.length, seeds: seeds.length },
    };
  });
}
