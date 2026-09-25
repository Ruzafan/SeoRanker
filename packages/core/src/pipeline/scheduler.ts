import { parseSettings, type Cadence } from '@seo/shared';
import { errorCode } from '../errors.js';
import type { PipelineContext } from './context.js';
import { assertQuota } from './quota.js';

const HOUR = 3_600_000;
/** Un poco menos que el periodo nominal para que el tick no se salte un día por unos minutos. */
const INTERVAL_MS: Record<Exclude<Cadence, 'off'>, number> = {
  daily: 22 * HOUR,
  weekly: 6 * 24 * HOUR + 22 * HOUR,
};
const DISCOVER_EVERY_MS = 7 * 24 * HOUR;

export interface SchedulerResult {
  generated: number;
  discovered: number;
  skipped: number;
}

/**
 * Tick de automatización: por cada sitio activo con cadencia, si toca, coge la keyword pendiente
 * de mayor score y lanza outline → write → publish (borrador en WP salvo autoPublish).
 * Si no quedan keywords, lanza un discover (como mucho una vez por semana); sin seeds, discover
 * las deduce del contenido de la tienda.
 */
export async function runScheduler(
  ctx: PipelineContext,
  now: Date = new Date(),
): Promise<SchedulerResult> {
  const result: SchedulerResult = { generated: 0, discovered: 0, skipped: 0 };
  const sites = await ctx.prisma.site.findMany({ where: { active: true } });

  for (const site of sites) {
    const settings = parseSettings(site.settings);
    if (settings.cadence === 'off') continue;
    const interval = INTERVAL_MS[settings.cadence];

    const last = await ctx.prisma.jobRun.findFirst({
      where: { siteId: site.id, type: 'schedule' },
      orderBy: { createdAt: 'desc' },
    });
    if (last && now.getTime() - last.createdAt.getTime() < interval) continue;

    const keyword = await ctx.prisma.keyword.findFirst({
      where: { siteId: site.id, status: 'pending' },
      orderBy: [{ score: 'desc' }, { createdAt: 'asc' }],
    });

    try {
      if (keyword) {
        await assertQuota(ctx.prisma, site.id, 'generate_article', ctx.config);
        await ctx.prisma.keyword.update({ where: { id: keyword.id }, data: { status: 'queued' } });
        await ctx.dispatcher.enqueue('outline', {
          siteId: site.id,
          refId: keyword.id,
          chain: 'publish',
        });
        await mark(ctx, site.id, now, { action: 'generate', keywordId: keyword.id });
        result.generated++;
      } else {
        // Sin seeds también: discover las deduce del contenido de la tienda.
        const lastDiscover = settings.lastDiscoverAt ? Date.parse(settings.lastDiscoverAt) : 0;
        if (now.getTime() - lastDiscover >= DISCOVER_EVERY_MS) {
          await ctx.dispatcher.enqueue('discover', { siteId: site.id });
          await mark(ctx, site.id, now, { action: 'discover' });
          result.discovered++;
        } else {
          result.skipped++;
        }
      }
    } catch (err) {
      // Cuota agotada, Redis caído… se anota y se reintenta en el siguiente tick elegible.
      await mark(ctx, site.id, now, { action: 'skipped', reason: errorCode(err) }, 'failed');
      ctx.log.warn({ siteId: site.id, reason: errorCode(err) }, 'scheduler skipped site');
      result.skipped++;
    }
  }
  return result;
}

async function mark(
  ctx: PipelineContext,
  siteId: string,
  now: Date,
  meta: Record<string, unknown>,
  status: 'succeeded' | 'failed' = 'succeeded',
): Promise<void> {
  await ctx.prisma.jobRun.create({
    data: {
      siteId,
      type: 'schedule',
      status,
      startedAt: now,
      finishedAt: now,
      error: status === 'failed' ? String(meta['reason'] ?? '') : null,
      meta: meta as never,
    },
  });
}
