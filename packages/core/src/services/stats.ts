import type { JobRun } from '@seo/db';
import type { Paginated, SiteStatsDto, UsageDto } from '@seo/shared';
import { articlesLimitForPlan } from '../pipeline/quota.js';
import { currentPeriod } from '../pipeline/usage.js';
import { requireSite, siteScope } from '../tenant.js';
import type { CoreDeps } from './deps.js';
import { toJobRunDto } from './mappers.js';

export async function listJobs(
  deps: CoreDeps,
  organizationId: string,
  siteId: string,
  page: number,
  pageSize: number,
): Promise<Paginated<JobRun>> {
  await requireSite(deps.prisma, organizationId, siteId);
  const scope = siteScope(deps.prisma, siteId);
  const [items, total] = await Promise.all([
    scope.jobs.findMany({
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    scope.jobs.count(),
  ]);
  return { items, page, pageSize, total };
}

export async function getUsage(
  deps: CoreDeps,
  organizationId: string,
  siteId: string,
): Promise<UsageDto> {
  await requireSite(deps.prisma, organizationId, siteId);
  const org = await deps.prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });
  const period = currentPeriod();
  const records = await deps.prisma.usageRecord.findMany({
    where: { siteId },
    orderBy: { period: 'desc' },
    take: 6,
  });
  const current = records.find((r) => r.period === period);
  return {
    period,
    articles: current?.articles ?? 0,
    inputTokens: current?.inputTokens ?? 0,
    outputTokens: current?.outputTokens ?? 0,
    costCents: current?.costCents ?? 0,
    plan: org.plan,
    articlesLimit: articlesLimitForPlan(org.plan, deps.config),
    history: records.map((r) => ({
      period: r.period,
      articles: r.articles,
      costCents: r.costCents,
    })),
  };
}

export async function getSiteStats(
  deps: CoreDeps,
  organizationId: string,
  siteId: string,
): Promise<SiteStatsDto> {
  await requireSite(deps.prisma, organizationId, siteId);
  const scope = siteScope(deps.prisma, siteId);
  const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
  const [
    publishedThisMonth,
    pendingKeywords,
    inProgressKw,
    inProgressArt,
    activeJobs,
    usage,
    recent,
  ] = await Promise.all([
    scope.articles.count({ status: 'published', publishedAt: { gte: monthStart } }),
    scope.keywords.count({ status: 'pending' }),
    scope.keywords.count({ status: { in: ['queued', 'processing'] } }),
    scope.articles.count({ status: { in: ['writing', 'publishing'] } }),
    scope.jobs.count({ status: { in: ['queued', 'running'] } }),
    getUsage(deps, organizationId, siteId),
    scope.jobs.findMany({ orderBy: { createdAt: 'desc' }, take: 8 }),
  ]);
  return {
    publishedThisMonth,
    pendingKeywords,
    inProgress: inProgressKw + inProgressArt + activeJobs,
    usage,
    recentJobs: recent.map(toJobRunDto),
  };
}
