import type { JobRun } from '@seo/db';
import {
  planFor,
  type Paginated,
  type SiteStatsDto,
  type SitesOverviewDto,
  type UsageDto,
} from '@seo/shared';
import { articlesLimitForPlan, organizationArticlesThisMonth } from '../pipeline/quota.js';
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
    organizationArticles: await organizationArticlesThisMonth(deps.prisma, organizationId, period),
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

/**
 * Vista de todas las tiendas de la organización en pocas consultas agrupadas (no N por tienda).
 * Solo lee sitios de `organizationId`: el aislamiento lo da el filtro de la primera consulta.
 */
export async function getSitesOverview(
  deps: CoreDeps,
  organizationId: string,
): Promise<SitesOverviewDto> {
  const org = await deps.prisma.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { plan: true, sites: { select: { id: true } } },
  });
  const siteIds = org.sites.map((s) => s.id);
  const plan = planFor(org.plan);
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const since = new Date(now.getTime() - 24 * 3_600_000);
  const inSites = { siteId: { in: siteIds } };

  const [published, pending, kwBusy, artBusy, jobsBusy, usage, failures] = await Promise.all([
    deps.prisma.article.groupBy({
      by: ['siteId'],
      where: { ...inSites, status: 'published', publishedAt: { gte: monthStart } },
      _count: { _all: true },
    }),
    deps.prisma.keyword.groupBy({
      by: ['siteId'],
      where: { ...inSites, status: 'pending' },
      _count: { _all: true },
    }),
    deps.prisma.keyword.groupBy({
      by: ['siteId'],
      where: { ...inSites, status: { in: ['queued', 'processing'] } },
      _count: { _all: true },
    }),
    deps.prisma.article.groupBy({
      by: ['siteId'],
      where: { ...inSites, status: { in: ['writing', 'publishing'] } },
      _count: { _all: true },
    }),
    deps.prisma.jobRun.groupBy({
      by: ['siteId'],
      where: { ...inSites, status: { in: ['queued', 'running'] } },
      _count: { _all: true },
    }),
    deps.prisma.usageRecord.findMany({ where: { ...inSites, period: currentPeriod() } }),
    deps.prisma.jobRun.findMany({
      where: { ...inSites, status: 'failed', createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      distinct: ['siteId'],
    }),
  ]);

  const count = (rows: { siteId: string; _count: { _all: number } }[], id: string) =>
    rows.find((r) => r.siteId === id)?._count._all ?? 0;

  return {
    plan: {
      id: plan.id,
      name: plan.name,
      maxSites: plan.maxSites,
      articlesPerMonth: articlesLimitForPlan(org.plan, deps.config),
    },
    sitesCount: siteIds.length,
    articlesThisMonth: usage.reduce((sum, u) => sum + u.articles, 0),
    sites: siteIds.map((id) => {
      const u = usage.find((r) => r.siteId === id);
      const f = failures.find((r) => r.siteId === id);
      return {
        siteId: id,
        publishedThisMonth: count(published, id),
        pendingKeywords: count(pending, id),
        inProgress: count(kwBusy, id) + count(artBusy, id) + count(jobsBusy, id),
        articlesThisMonth: u?.articles ?? 0,
        costCents: u?.costCents ?? 0,
        lastFailure: f ? { type: f.type, error: f.error, at: f.createdAt.toISOString() } : null,
      };
    }),
  };
}
