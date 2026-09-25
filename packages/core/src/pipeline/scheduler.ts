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
  /** Artículos programados enviados a publicar en este tick. */
  scheduled: number;
}

/**
 * Publica los artículos listos cuya fecha programada ya llegó (con la aprobación del cliente si el
 * sitio la exige). Se marcan `publishing` al encolar para que el siguiente tick no los repita.
 */
async function publishDue(
  ctx: PipelineContext,
  sites: { id: string; settings: unknown }[],
  now: Date,
): Promise<number> {
  let count = 0;
  for (const site of sites) {
    const settings = parseSettings(site.settings);
    const due = await ctx.prisma.article.findMany({
      where: {
        siteId: site.id,
        status: 'ready',
        scheduledFor: { lte: now },
        ...(settings.requireApproval ? { reviewStatus: 'approved' } : {}),
      },
      select: { id: true },
    });
    for (const a of due) {
      await ctx.prisma.article.updateMany({
        where: { id: a.id, siteId: site.id },
        data: { status: 'publishing' },
      });
      try {
        await ctx.dispatcher.enqueue('publish', { siteId: site.id, refId: a.id });
        count++;
      } catch (err) {
        await ctx.prisma.article.updateMany({
          where: { id: a.id, siteId: site.id },
          data: { status: 'ready' },
        });
        ctx.log.warn(
          { siteId: site.id, reason: errorCode(err) },
          'scheduled publish failed to enqueue',
        );
      }
    }
  }
  return count;
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
  const result: SchedulerResult = { generated: 0, discovered: 0, skipped: 0, scheduled: 0 };
  const sites = await ctx.prisma.site.findMany({ where: { active: true } });
  result.scheduled = await publishDue(ctx, sites, now);

  for (const site of sites) {
    const settings = parseSettings(site.settings);
    if (settings.cadence === 'off') continue;
    const interval = INTERVAL_MS[settings.cadence];

    const last = await ctx.prisma.jobRun.findFirst({
      where: { siteId: site.id, type: 'schedule' },
      orderBy: { createdAt: 'desc' },
    });
    if (last && now.getTime() - last.createdAt.getTime() < interval) continue;

    const keyword = await pickNextKeyword(ctx, site.id);

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

/**
 * Orden de escritura con clusters: primero las pilares (la guía amplia de cada tema), después los
 * satélites de temas cuya pilar ya existe (así enlazan hacia ella) y por último el resto por puntuación.
 */
export async function pickNextKeyword(ctx: PipelineContext, siteId: string) {
  const order = [{ score: 'desc' as const }, { createdAt: 'asc' as const }];
  const clusters = await ctx.prisma.keywordCluster.findMany({
    where: { siteId },
    select: { id: true, pillarKeywordId: true },
  });
  const pillarIds = clusters.map((c) => c.pillarKeywordId).filter((id): id is string => !!id);
  if (pillarIds.length) {
    const pillar = await ctx.prisma.keyword.findFirst({
      where: { siteId, status: 'pending', id: { in: pillarIds } },
      orderBy: order,
    });
    if (pillar) return pillar;
    const donePillars = await ctx.prisma.keyword.findMany({
      where: { siteId, id: { in: pillarIds }, status: 'done' },
      select: { clusterId: true },
    });
    const ready = donePillars.map((p) => p.clusterId).filter((id): id is string => !!id);
    if (ready.length) {
      const satellite = await ctx.prisma.keyword.findFirst({
        where: { siteId, status: 'pending', clusterId: { in: ready } },
        orderBy: order,
      });
      if (satellite) return satellite;
    }
  }
  return ctx.prisma.keyword.findFirst({ where: { siteId, status: 'pending' }, orderBy: order });
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

const SYNC_EVERY_MS = 20 * HOUR;

/**
 * Encola `sync` (posts, Search Console, pedidos) una vez al día por sitio activo que tenga algo que
 * sincronizar: Search Console conectado o artículos enviados a WordPress.
 */
export async function runSyncScheduler(
  ctx: PipelineContext,
  now: Date = new Date(),
): Promise<{ enqueued: number }> {
  const sites = await ctx.prisma.site.findMany({
    where: {
      active: true,
      OR: [
        { searchConsole: { isNot: null } },
        { articles: { some: { remotePostId: { not: null } } } },
      ],
    },
    select: { id: true },
  });
  let enqueued = 0;
  for (const site of sites) {
    const last = await ctx.prisma.jobRun.findFirst({
      where: { siteId: site.id, type: 'sync' },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    if (last && now.getTime() - last.createdAt.getTime() < SYNC_EVERY_MS) continue;
    try {
      await ctx.dispatcher.enqueue('sync', { siteId: site.id });
      enqueued++;
    } catch (err) {
      ctx.log.warn({ siteId: site.id, reason: errorCode(err) }, 'sync scheduler skipped site');
    }
  }
  return { enqueued };
}
