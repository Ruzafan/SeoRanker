import { planFor, type ArticlePerformanceDto, type PerformanceDto } from '@seo/shared';
import { requireSite, siteScope } from '../tenant.js';
import type { CoreDeps } from './deps.js';
import { getSearchConsoleStatus } from './search-console.js';

const DAY = 86_400_000;
const WINDOW_DAYS = 28;
const DAILY_DAYS = 90;
const iso = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Rendimiento real: últimos 28 días con datos frente a los 28 anteriores, serie diaria,
 * tabla por artículo (clics, posición, ventas atribuidas, caída) y oportunidades de Search Console.
 */
export async function getPerformance(
  deps: CoreDeps,
  organizationId: string,
  siteId: string,
): Promise<PerformanceDto> {
  const site = await requireSite(deps.prisma, organizationId, siteId);
  const scope = siteScope(deps.prisma, site.id);
  const org = await deps.prisma.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { plan: true },
  });
  const [searchConsole, latest] = await Promise.all([
    getSearchConsoleStatus(deps, organizationId, site.id),
    deps.prisma.articleMetric.findFirst({
      where: { siteId: site.id },
      orderBy: { date: 'desc' },
      select: { date: true },
    }),
  ]);

  const end = latest?.date ?? null;
  const from = end ? new Date(end.getTime() - (WINDOW_DAYS - 1) * DAY) : null;
  const prevFrom = from ? new Date(from.getTime() - WINDOW_DAYS * DAY) : null;
  const prevTo = from ? new Date(from.getTime() - DAY) : null;
  const revenueFrom = new Date(Date.now() - WINDOW_DAYS * DAY);

  const [current, previous, daily, articles, revenue, opportunities] = await Promise.all([
    end && from
      ? deps.prisma.articleMetric.groupBy({
          by: ['articleId'],
          where: { siteId: site.id, date: { gte: from, lte: end } },
          _sum: { clicks: true, impressions: true },
        })
      : [],
    prevFrom && prevTo
      ? deps.prisma.articleMetric.groupBy({
          by: ['articleId'],
          where: { siteId: site.id, date: { gte: prevFrom, lte: prevTo } },
          _sum: { clicks: true, impressions: true },
        })
      : [],
    end
      ? deps.prisma.articleMetric.groupBy({
          by: ['date'],
          where: {
            siteId: site.id,
            date: { gte: new Date(end.getTime() - (DAILY_DAYS - 1) * DAY) },
          },
          _sum: { clicks: true, impressions: true },
          orderBy: { date: 'asc' },
        })
      : [],
    scope.articles.findMany({
      where: { OR: [{ remotePostId: { not: null } }, { status: 'published' }] },
      select: { id: true, title: true, remoteUrl: true, remoteStatus: true, decayDetectedAt: true },
    }),
    deps.prisma.articleConversion.groupBy({
      by: ['articleId', 'currency'],
      where: { siteId: site.id, orderedAt: { gte: revenueFrom } },
      _sum: { total: true },
      _count: { _all: true },
    }),
    scope.keywords.findMany({
      where: { source: 'gsc', status: { in: ['pending', 'queued', 'processing'] } },
      orderBy: [{ score: 'desc' }, { gscImpressions: 'desc' }],
      take: 10,
    }),
  ]);

  // Posición media ponderada por impresiones: la calcula la BD sobre la ventana actual.
  const positions =
    end && from
      ? await deps.prisma.$queryRaw<{ articleId: string; position: number | null }[]>`
          SELECT "articleId", SUM("position" * "impressions") / NULLIF(SUM("impressions"), 0) AS position
          FROM "ArticleMetric"
          WHERE "siteId" = ${site.id} AND "date" >= ${from} AND "date" <= ${end}
          GROUP BY "articleId"`
      : [];

  const cur = new Map(current.map((r) => [r.articleId, r._sum]));
  const prev = new Map(previous.map((r) => [r.articleId, r._sum]));
  const pos = new Map(
    positions.map((r) => [r.articleId, r.position === null ? null : Number(r.position)]),
  );
  const rev = new Map<string, { total: number; orders: number }>();
  for (const r of revenue) {
    const e = rev.get(r.articleId) ?? { total: 0, orders: 0 };
    e.total += r._sum.total ?? 0;
    e.orders += r._count._all;
    rev.set(r.articleId, e);
  }

  const rows: ArticlePerformanceDto[] = articles
    .map((a) => ({
      articleId: a.id,
      title: a.title,
      remoteUrl: a.remoteUrl,
      remoteStatus: a.remoteStatus,
      clicks: cur.get(a.id)?.clicks ?? 0,
      impressions: cur.get(a.id)?.impressions ?? 0,
      position: pos.get(a.id) ?? null,
      previousClicks: prev.get(a.id)?.clicks ?? 0,
      revenue: Math.round((rev.get(a.id)?.total ?? 0) * 100) / 100,
      orders: rev.get(a.id)?.orders ?? 0,
      decaying: !!a.decayDetectedAt,
    }))
    .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions);

  const sum = (xs: number[]) => xs.reduce((n, x) => n + x, 0);
  const clicks = sum(rows.map((r) => r.clicks));
  const impressions = sum(rows.map((r) => r.impressions));
  const weighted = rows.filter((r) => r.position !== null && r.impressions > 0);
  return {
    searchConsole,
    period: end && from ? { from: iso(from), to: iso(end) } : null,
    totals: {
      clicks,
      impressions,
      ctr: impressions ? clicks / impressions : 0,
      position: weighted.length
        ? sum(weighted.map((r) => (r.position ?? 0) * r.impressions)) /
          sum(weighted.map((r) => r.impressions))
        : null,
      previousClicks: sum(previous.map((r) => r._sum.clicks ?? 0)),
      previousImpressions: sum(previous.map((r) => r._sum.impressions ?? 0)),
      revenue: Math.round(sum(rows.map((r) => r.revenue)) * 100) / 100,
      orders: sum(rows.map((r) => r.orders)),
      currency: revenue[0]?.currency ?? null,
    },
    daily: daily.map((d) => ({
      date: iso(d.date),
      clicks: d._sum.clicks ?? 0,
      impressions: d._sum.impressions ?? 0,
    })),
    articles: rows,
    opportunities: opportunities.map((k) => ({
      keywordId: k.id,
      term: k.term,
      impressions: k.gscImpressions ?? 0,
      clicks: k.gscClicks ?? 0,
      position: k.gscPosition,
      score: k.score,
      status: k.status,
    })),
    revenueEnabled: planFor(org.plan).revenueAttribution,
  };
}
