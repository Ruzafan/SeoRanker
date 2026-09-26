import { planFor, type MonthlyReportDto } from '@seo/shared';
import { requireSite, siteScope } from '../tenant.js';
import type { CoreDeps } from './deps.js';
import { getBranding } from './organization.js';

function monthRange(month: string): { from: Date; to: Date; prevFrom: Date; prevTo: Date } {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const from = new Date(Date.UTC(y, m - 1, 1));
  const next = new Date(Date.UTC(y, m, 1));
  const prevFrom = new Date(Date.UTC(y, m - 2, 1));
  return { from, to: new Date(next.getTime() - 1), prevFrom, prevTo: new Date(from.getTime() - 1) };
}

/** Informe mensual de una tienda para el cliente final (marca blanca en planes Agency). */
export async function getMonthlyReport(
  deps: CoreDeps,
  organizationId: string,
  siteId: string,
  month: string,
): Promise<MonthlyReportDto> {
  const site = await requireSite(deps.prisma, organizationId, siteId);
  const scope = siteScope(deps.prisma, site.id);
  const { from, to, prevFrom, prevTo } = monthRange(month);
  const org = await deps.prisma.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { plan: true },
  });
  const hasSearch = !!(await deps.prisma.searchConsoleConnection.findUnique({
    where: { siteId: site.id },
  }));
  const inMonth = { siteId: site.id, date: { gte: from, lte: to } };

  const [
    published,
    current,
    previous,
    positions,
    top,
    revenue,
    opportunities,
    refreshed,
    branding,
  ] = await Promise.all([
    scope.articles.findMany({
      where: { publishedAt: { gte: from, lte: to } },
      orderBy: { publishedAt: 'asc' },
    }),
    deps.prisma.articleMetric.aggregate({
      where: inMonth,
      _sum: { clicks: true, impressions: true },
    }),
    deps.prisma.articleMetric.aggregate({
      where: { siteId: site.id, date: { gte: prevFrom, lte: prevTo } },
      _sum: { clicks: true, impressions: true },
    }),
    deps.prisma.$queryRaw<{ position: number | null }[]>`
        SELECT SUM("position" * "impressions") / NULLIF(SUM("impressions"), 0) AS position
        FROM "ArticleMetric" WHERE "siteId" = ${site.id} AND "date" >= ${from} AND "date" <= ${to}`,
    deps.prisma.articleMetric.groupBy({
      by: ['articleId'],
      where: inMonth,
      _sum: { clicks: true, impressions: true },
      orderBy: { _sum: { clicks: 'desc' } },
      take: 10,
    }),
    planFor(org.plan).revenueAttribution
      ? deps.prisma.articleConversion.groupBy({
          by: ['currency'],
          where: { siteId: site.id, orderedAt: { gte: from, lte: to } },
          _sum: { total: true },
          _count: { _all: true },
        })
      : Promise.resolve(null),
    scope.keywords.findMany({
      where: { source: 'gsc', status: 'pending' },
      orderBy: [{ score: 'desc' }],
      take: 5,
    }),
    scope.articles.count({ refreshedAt: { gte: from, lte: to } }),
    getBranding(deps, organizationId),
  ]);

  const titles = new Map(
    (
      await scope.articles.findMany({
        where: { id: { in: top.map((t) => t.articleId) } },
        select: { id: true, title: true, remoteUrl: true },
      })
    ).map((a) => [a.id, a]),
  );
  const rev = revenue?.[0];
  return {
    site: { name: site.name, url: site.url },
    month,
    branding,
    published: published.map((a) => ({
      id: a.id,
      title: a.title,
      url: a.remoteUrl,
      publishedAt: (a.publishedAt ?? a.updatedAt).toISOString(),
    })),
    search: hasSearch
      ? {
          clicks: current._sum.clicks ?? 0,
          impressions: current._sum.impressions ?? 0,
          previousClicks: previous._sum.clicks ?? 0,
          previousImpressions: previous._sum.impressions ?? 0,
          position:
            positions[0]?.position === null || positions[0]?.position === undefined
              ? null
              : Number(positions[0].position),
        }
      : null,
    topArticles: top.map((t) => ({
      title: titles.get(t.articleId)?.title ?? '—',
      url: titles.get(t.articleId)?.remoteUrl ?? null,
      clicks: t._sum.clicks ?? 0,
      impressions: t._sum.impressions ?? 0,
    })),
    revenue: revenue
      ? {
          total: Math.round((rev?._sum.total ?? 0) * 100) / 100,
          orders: rev?._count._all ?? 0,
          currency: rev?.currency ?? null,
        }
      : null,
    opportunities: opportunities.map((k) => ({
      term: k.term,
      impressions: k.gscImpressions ?? 0,
      position: k.gscPosition,
    })),
    refreshed,
  };
}
