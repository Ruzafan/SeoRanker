import {
  CONNECTOR_VERSION_VISITS,
  aiAssistant,
  isOlderVersion,
  parseSettings,
  planFor,
  type MonthlyReportDto,
  type TrafficChannel,
} from '@seo/shared';
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
    live,
    articleMetrics,
    visits,
    conversions,
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
    scope.articles.findMany({
      where: { remoteUrl: { not: null }, publishedAt: { lte: to }, remoteStatus: 'publish' },
      orderBy: { publishedAt: 'desc' },
      select: { id: true, title: true, remoteUrl: true, publishedAt: true, updatedAt: true },
    }),
    deps.prisma.articleMetric.groupBy({
      by: ['articleId'],
      where: inMonth,
      _sum: { clicks: true, impressions: true },
    }),
    deps.prisma.articleVisit.groupBy({
      by: ['articleId', 'channel', 'source'],
      where: inMonth,
      _sum: { visits: true },
    }),
    deps.prisma.articleConversion.findMany({
      where: { siteId: site.id, orderedAt: { gte: from, lte: to } },
      select: { articleId: true, total: true, currency: true, channel: true },
    }),
  ]);
  // Posición media ponderada por impresiones de cada artículo en el mes.
  const articlePositions = new Map(
    (
      await deps.prisma.$queryRaw<{ articleId: string; position: number | null }[]>`
        SELECT "articleId", SUM("position" * "impressions") / NULLIF(SUM("impressions"), 0) AS position
        FROM "ArticleMetric" WHERE "siteId" = ${site.id} AND "date" >= ${from} AND "date" <= ${to}
        GROUP BY "articleId"`
    ).map((r) => [r.articleId, r.position === null ? null : Number(r.position)]),
  );
  const metricsBy = new Map(articleMetrics.map((m) => [m.articleId, m._sum]));
  const channelTotals = new Map<TrafficChannel, number>();
  const assistantTotals = new Map<string, number>();
  const visitsBy = new Map<string, Map<TrafficChannel, number>>();
  for (const v of visits) {
    const n = v._sum.visits ?? 0;
    const channel = v.channel as TrafficChannel;
    channelTotals.set(channel, (channelTotals.get(channel) ?? 0) + n);
    const assistant = channel === 'ai' ? aiAssistant(v.source) : null;
    if (assistant) assistantTotals.set(assistant, (assistantTotals.get(assistant) ?? 0) + n);
    const per = visitsBy.get(v.articleId) ?? new Map<TrafficChannel, number>();
    per.set(channel, (per.get(channel) ?? 0) + n);
    visitsBy.set(v.articleId, per);
  }
  const sorted = <K>(m: Map<K, number>) => [...m.entries()].sort((a, b) => b[1] - a[1]);
  const revenueEnabled = planFor(org.plan).revenueAttribution;
  const ordersBy = new Map<string, { orders: number; revenue: number }>();
  const revenueChannels = new Map<TrafficChannel | null, { orders: number; total: number }>();
  for (const c of revenueEnabled ? conversions : []) {
    const a = ordersBy.get(c.articleId) ?? { orders: 0, revenue: 0 };
    ordersBy.set(c.articleId, { orders: a.orders + 1, revenue: a.revenue + c.total });
    const key = (c.channel as TrafficChannel | null) ?? null;
    const r = revenueChannels.get(key) ?? { orders: 0, total: 0 };
    revenueChannels.set(key, { orders: r.orders + 1, total: r.total + c.total });
  }
  const round = (n: number) => Math.round(n * 100) / 100;
  const connectorVersion = parseSettings(site.settings).connectorVersion;

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
    articles: live.map((a) => {
      const m = metricsBy.get(a.id);
      const per = visitsBy.get(a.id) ?? new Map<TrafficChannel, number>();
      const o = ordersBy.get(a.id);
      return {
        id: a.id,
        title: a.title,
        url: a.remoteUrl,
        publishedAt: (a.publishedAt ?? a.updatedAt).toISOString(),
        google: hasSearch
          ? {
              clicks: m?.clicks ?? 0,
              impressions: m?.impressions ?? 0,
              position: articlePositions.get(a.id) ?? null,
            }
          : null,
        visits: [...per.values()].reduce((s, n) => s + n, 0),
        visitsByChannel: sorted(per).map(([channel, visits]) => ({ channel, visits })),
        orders: o?.orders ?? 0,
        revenue: round(o?.revenue ?? 0),
      };
    }),
    traffic: {
      measured:
        connectorVersion !== null && !isOlderVersion(connectorVersion, CONNECTOR_VERSION_VISITS),
      total: [...channelTotals.values()].reduce((s, n) => s + n, 0),
      byChannel: sorted(channelTotals).map(([channel, visits]) => ({ channel, visits })),
      assistants: sorted(assistantTotals).map(([name, visits]) => ({ name, visits })),
    },
    revenue: revenue
      ? {
          total: round(rev?._sum.total ?? 0),
          orders: rev?._count._all ?? 0,
          currency: rev?.currency ?? null,
          byChannel: [...revenueChannels.entries()]
            .sort((a, b) => b[1].total - a[1].total)
            .map(([channel, r]) => ({ channel, orders: r.orders, total: round(r.total) })),
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
