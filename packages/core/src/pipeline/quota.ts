import type { PrismaClient } from '@seo/db';
import { articlesPerMonthFor } from '@seo/shared';
import { AppError, notFound } from '../errors.js';
import { currentPeriod } from './usage.js';

export type QuotaAction = 'generate_article' | 'discover';

export interface QuotaConfig {
  freePlanMaxArticles: number;
}

/** null = sin tope. Los límites viven en PLANS (@seo/shared); el de free, en el entorno. */
export function articlesLimitForPlan(plan: string, config: QuotaConfig): number | null {
  return articlesPerMonthFor(plan, config.freePlanMaxArticles);
}

/**
 * Lanza QUOTA_EXCEEDED si el plan de la organización no permite la acción.
 * Tope de artículos/mes del plan, incluyendo los ya en curso.
 */
export async function assertQuota(
  prisma: PrismaClient,
  siteId: string,
  action: QuotaAction,
  config: QuotaConfig,
  extraInFlight = 0,
): Promise<void> {
  const site = await prisma.site.findUnique({
    where: { id: siteId },
    select: { organization: { select: { plan: true } } },
  });
  if (!site) throw notFound('Site');
  if (action !== 'generate_article') return;

  const limit = articlesLimitForPlan(site.organization.plan, config);
  if (limit === null) return;

  const [usage, inFlight] = await Promise.all([
    prisma.usageRecord.findUnique({
      where: { siteId_period: { siteId, period: currentPeriod() } },
    }),
    prisma.keyword.count({ where: { siteId, status: { in: ['queued', 'processing'] } } }),
  ]);
  if ((usage?.articles ?? 0) + inFlight + extraInFlight >= limit) {
    throw new AppError('QUOTA_EXCEEDED', `Monthly article limit reached (${limit})`, {
      httpStatus: 402,
    });
  }
}
