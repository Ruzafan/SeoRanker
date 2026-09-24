import type { PrismaClient } from '@seo/db';
import type { Logger } from './context.js';

export interface WatchdogOptions {
  now?: Date;
  /** Minutos en `processing`/`writing`/`publishing` antes de considerar zombi. Por defecto 20. */
  staleMinutes?: number;
  /** Minutos en `queued` (sin que nadie lo recoja) antes de devolverlo a `pending`. Por defecto 120. */
  queuedMinutes?: number;
}

export interface WatchdogResult {
  keywords: number;
  articles: number;
  jobRuns: number;
}

const minutesAgo = (now: Date, m: number): Date => new Date(now.getTime() - m * 60_000);

/**
 * Devuelve a un estado recuperable todo lo que lleva demasiado tiempo "en curso":
 * Keyword processing → pending, Article writing → draft, Article publishing → ready,
 * y cierra JobRun colgados. Anota lo recuperado en un JobRun `watchdog` por sitio.
 */
export async function runWatchdog(
  prisma: PrismaClient,
  log: Logger,
  opts: WatchdogOptions = {},
): Promise<WatchdogResult> {
  const now = opts.now ?? new Date();
  const staleCutoff = minutesAgo(now, opts.staleMinutes ?? 20);
  const queuedCutoff = minutesAgo(now, opts.queuedMinutes ?? 120);

  const zombieKeywords = await prisma.keyword.findMany({
    where: {
      OR: [
        { status: 'processing', updatedAt: { lt: staleCutoff } },
        { status: 'queued', updatedAt: { lt: queuedCutoff } },
      ],
    },
    select: { id: true, siteId: true },
  });
  const zombieArticles = await prisma.article.findMany({
    where: { status: { in: ['writing', 'publishing'] }, updatedAt: { lt: staleCutoff } },
    select: { id: true, siteId: true, status: true, contentHtml: true },
  });

  const perSite = new Map<string, { keywords: string[]; articles: string[] }>();
  const bucket = (siteId: string) => {
    let b = perSite.get(siteId);
    if (!b) perSite.set(siteId, (b = { keywords: [], articles: [] }));
    return b;
  };

  if (zombieKeywords.length) {
    await prisma.keyword.updateMany({
      where: { id: { in: zombieKeywords.map((k) => k.id) } },
      data: { status: 'pending' },
    });
    zombieKeywords.forEach((k) => bucket(k.siteId).keywords.push(k.id));
  }
  for (const a of zombieArticles) {
    const next = a.status === 'publishing' && a.contentHtml ? 'ready' : 'draft';
    await prisma.article.update({ where: { id: a.id }, data: { status: next } });
    bucket(a.siteId).articles.push(a.id);
  }

  const stuckRuns = await prisma.jobRun.updateMany({
    where: {
      OR: [
        { status: 'running', startedAt: { lt: minutesAgo(now, 30) } },
        { status: 'queued', createdAt: { lt: queuedCutoff } },
      ],
    },
    data: {
      status: 'failed',
      error: 'WATCHDOG_TIMEOUT: job did not finish in time',
      finishedAt: now,
    },
  });

  for (const [siteId, rec] of perSite) {
    await prisma.jobRun.create({
      data: {
        siteId,
        type: 'watchdog',
        status: 'succeeded',
        startedAt: now,
        finishedAt: now,
        meta: { recoveredKeywords: rec.keywords, recoveredArticles: rec.articles },
      },
    });
  }

  const result = {
    keywords: zombieKeywords.length,
    articles: zombieArticles.length,
    jobRuns: stuckRuns.count,
  };
  if (result.keywords || result.articles || result.jobRuns)
    log.warn({ ...result }, 'watchdog recovered stuck work');
  return result;
}
