import type { PrismaClient } from '@seo/db';
import { articlesPerMonthFor } from '@seo/shared';
import { AppError, notFound } from '../errors.js';
import { currentPeriod } from './usage.js';

export type QuotaAction = 'generate_article' | 'discover';

export interface QuotaConfig {
  freePlanMaxArticles: number;
}

/** Tope mensual de artículos de la organización. Los límites viven en PLANS (@seo/shared); el de free, en el entorno. */
export function articlesLimitForPlan(plan: string, config: QuotaConfig): number {
  return articlesPerMonthFor(plan, config.freePlanMaxArticles);
}

/** Artículos generados este mes por TODA la organización (el tope del plan es por organización). */
export async function organizationArticlesThisMonth(
  prisma: Pick<PrismaClient, 'usageRecord'>,
  organizationId: string,
  period: string = currentPeriod(),
): Promise<number> {
  const agg = await prisma.usageRecord.aggregate({
    where: { period, site: { organizationId } },
    _sum: { articles: true },
  });
  return agg._sum.articles ?? 0;
}

/**
 * Lanza QUOTA_EXCEEDED si el plan de la organización no permite la acción.
 * Tope de artículos/mes del plan sumando todas sus tiendas, incluidos los ya en curso.
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
    select: { organizationId: true, organization: { select: { plan: true } } },
  });
  if (!site) throw notFound('Site');
  if (action !== 'generate_article') return;

  const limit = articlesLimitForPlan(site.organization.plan, config);
  const [used, inFlight] = await Promise.all([
    organizationArticlesThisMonth(prisma, site.organizationId),
    prisma.keyword.count({
      where: {
        site: { organizationId: site.organizationId },
        status: { in: ['queued', 'processing'] },
      },
    }),
  ]);
  if (used + inFlight + extraInFlight >= limit) {
    throw new AppError('QUOTA_EXCEEDED', `Monthly article limit reached (${limit})`, {
      httpStatus: 402,
    });
  }
}
