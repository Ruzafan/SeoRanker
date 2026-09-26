import type { Site } from '@seo/db';
import { parseSettings, planFor } from '@seo/shared';
import { decryptJson } from '../crypto.js';
import { errorCode, errorMessage } from '../errors.js';
import { GoogleClient, urlKey, type SearchAnalyticsRow } from '../integrations/google.js';
import { normalizeTerm } from '../keywords/provider.js';
import { siteScope } from '../tenant.js';
import { blendScore } from '../keywords/metrics.js';
import { adapterFor, loadSite, metricsProviderFor } from './common.js';
import type { PipelineContext, RunInfo } from './context.js';
import { runTracked } from './run-tracked.js';

const DAY = 86_400_000;
/** Search Console tarda ~2 días en consolidar datos. */
const GSC_LAG_DAYS = 2;
/** Primera sincronización: los últimos 90 días. Después se relee una semana (los datos se corrigen). */
const GSC_INITIAL_DAYS = 90;
const GSC_OVERLAP_DAYS = 7;
/** "Striking distance": consultas que ya asoman en la página 1-2 de Google. */
export const OPPORTUNITY_MIN_POSITION = 8;
export const OPPORTUNITY_MAX_POSITION = 20;
export const OPPORTUNITY_MIN_IMPRESSIONS = 20;
const MAX_NEW_OPPORTUNITIES = 30;
/** Caída: pierde más del 30 % de clics frente a los 28 días anteriores (con al menos 10 de base). */
const DECAY_WINDOW_DAYS = 28;
const DECAY_MIN_BASE_CLICKS = 10;
const DECAY_RATIO = 0.7;
const RECOVERED_RATIO = 0.9;
const ORDERS_INITIAL_DAYS = 90;
const MAX_ORDER_PAGES = 20;

export const isoDate = (d: Date): string => d.toISOString().slice(0, 10);
const daysAgo = (now: Date, n: number): Date => new Date(now.getTime() - n * DAY);
const dayStart = (d: Date): Date => new Date(`${isoDate(d)}T00:00:00.000Z`);

/**
 * Sincronización diaria de un sitio: estado real de los posts en WordPress, rendimiento en Google
 * (Search Console), oportunidades de keywords, artículos en caída y ventas atribuidas.
 * Cada parte es independiente: si una falla, las demás siguen y el error queda en el meta.
 */
export function runSync(ctx: PipelineContext, info: RunInfo): Promise<void> {
  return runTracked(ctx, info, async () => {
    const site = await loadSite(ctx, info.siteId);
    const now = new Date();
    const meta: Record<string, unknown> = {};
    const part = async (name: string, fn: () => Promise<unknown>) => {
      try {
        meta[name] = await fn();
      } catch (err) {
        meta[name] = { error: errorCode(err), detail: errorMessage(err).slice(0, 300) };
        ctx.log.warn({ siteId: site.id, part: name, code: errorCode(err) }, 'sync part failed');
      }
    };
    await part('posts', () => syncPosts(ctx, site));
    await part('searchConsole', () => syncSearchConsole(ctx, site, now));
    await part('orders', () => syncOrders(ctx, site, now));
    await part('keywordMetrics', () => syncKeywordMetrics(ctx, site));
    return { meta };
  });
}

async function syncPosts(ctx: PipelineContext, site: Site): Promise<unknown> {
  const scope = siteScope(ctx.prisma, site.id);
  const articles = await scope.articles.findMany({
    where: { remotePostId: { not: null } },
    select: { id: true, remotePostId: true, remoteUrl: true, remoteStatus: true },
  });
  if (!articles.length) return { checked: 0, updated: 0 };
  const infos = await adapterFor(ctx, site).getPostsInfo(
    articles.map((a) => a.remotePostId).filter((id): id is number => id !== null),
  );
  const byId = new Map(infos.map((i) => [i.id, i]));
  const settings = parseSettings(site.settings);
  let updated = 0;
  let wentLive = 0;
  for (const a of articles) {
    const info = a.remotePostId === null ? undefined : byId.get(a.remotePostId);
    const next = info
      ? { remoteUrl: info.url || a.remoteUrl, remoteStatus: info.status }
      : { remoteUrl: a.remoteUrl, remoteStatus: 'missing' };
    if (next.remoteUrl !== a.remoteUrl || next.remoteStatus !== a.remoteStatus) {
      await scope.articles.updateById(a.id, next);
      updated++;
      if (
        next.remoteStatus === 'publish' &&
        a.remoteStatus !== 'publish' &&
        settings.autoBacklinks
      ) {
        await ctx.dispatcher
          .enqueue('backlink', { siteId: site.id, refId: a.id })
          .catch(() => undefined);
        wentLive++;
      }
    }
  }
  return { checked: articles.length, updated, wentLive };
}

async function syncSearchConsole(ctx: PipelineContext, site: Site, now: Date): Promise<unknown> {
  const conn = await ctx.prisma.searchConsoleConnection.findUnique({ where: { siteId: site.id } });
  if (!conn || !conn.propertyUrl) return { skipped: 'NOT_CONNECTED' };
  if (!ctx.config.google) return { skipped: 'GOOGLE_NOT_CONFIGURED' };

  const google = new GoogleClient(ctx.config.google, ctx.fetchFn);
  try {
    const { refreshToken } = decryptJson<{ refreshToken: string }>(
      ctx.encryptionKey,
      conn.credentials,
    );
    const token = await google.accessToken(refreshToken);
    const end = daysAgo(now, GSC_LAG_DAYS);
    const start = conn.lastSyncAt
      ? daysAgo(conn.lastSyncAt, GSC_OVERLAP_DAYS + GSC_LAG_DAYS)
      : daysAgo(end, GSC_INITIAL_DAYS);

    const byUrl = await articlesByUrl(ctx, site.id);
    const metricRows = await google.searchAnalytics(token, conn.propertyUrl, {
      startDate: isoDate(start),
      endDate: isoDate(end),
      dimensions: ['date', 'page'],
    });
    const metrics = await storeMetrics(
      ctx,
      site.id,
      metricRows,
      byUrl,
      dayStart(start),
      dayStart(end),
    );

    const queryRows = await google.searchAnalytics(
      token,
      conn.propertyUrl,
      {
        startDate: isoDate(daysAgo(end, DECAY_WINDOW_DAYS - 1)),
        endDate: isoDate(end),
        dimensions: ['query', 'page'],
      },
      10_000,
    );
    const opportunities = await storeOpportunities(ctx, site, queryRows, byUrl);
    const decay = await detectDecay(ctx, site, dayStart(end));

    await ctx.prisma.searchConsoleConnection.update({
      where: { id: conn.id },
      data: { lastSyncAt: now, lastError: null },
    });
    return { metrics, opportunities, decay };
  } catch (err) {
    await ctx.prisma.searchConsoleConnection.update({
      where: { id: conn.id },
      data: { lastError: errorCode(err) },
    });
    throw err;
  }
}

async function articlesByUrl(ctx: PipelineContext, siteId: string): Promise<Map<string, string>> {
  const articles = await siteScope(ctx.prisma, siteId).articles.findMany({
    where: { remoteUrl: { not: null } },
    select: { id: true, remoteUrl: true },
  });
  return new Map(
    articles.filter((a) => a.remoteUrl).map((a) => [urlKey(a.remoteUrl as string), a.id]),
  );
}

/** Reemplaza las métricas del rango: Search Console corrige los últimos días a posteriori. */
async function storeMetrics(
  ctx: PipelineContext,
  siteId: string,
  rows: SearchAnalyticsRow[],
  byUrl: Map<string, string>,
  start: Date,
  end: Date,
): Promise<{ rows: number; stored: number }> {
  // Varias URL (con y sin barra, http/https) pueden ser el mismo artículo: se agregan.
  const agg = new Map<
    string,
    { articleId: string; date: Date; clicks: number; impressions: number; posSum: number }
  >();
  for (const r of rows) {
    const [date, page] = r.keys;
    const articleId = page ? byUrl.get(urlKey(page)) : undefined;
    if (!date || !articleId) continue;
    const key = `${articleId}|${date}`;
    const cur = agg.get(key) ?? {
      articleId,
      date: new Date(`${date}T00:00:00.000Z`),
      clicks: 0,
      impressions: 0,
      posSum: 0,
    };
    cur.clicks += r.clicks;
    cur.impressions += r.impressions;
    cur.posSum += r.position * r.impressions;
    agg.set(key, cur);
  }
  const data = [...agg.values()].map((a) => ({
    siteId,
    articleId: a.articleId,
    date: a.date,
    clicks: a.clicks,
    impressions: a.impressions,
    position: a.impressions ? a.posSum / a.impressions : 0,
  }));
  await ctx.prisma.$transaction([
    ctx.prisma.articleMetric.deleteMany({ where: { siteId, date: { gte: start, lte: end } } }),
    ctx.prisma.articleMetric.createMany({ data }),
  ]);
  return { rows: rows.length, stored: data.length };
}

interface QueryAgg {
  term: string;
  clicks: number;
  impressions: number;
  posSum: number;
  bestPage: string;
  bestPageImpressions: number;
}

/** Puntuación 1-100: más impresiones y más cerca de la página 1 = más prioridad. */
export function opportunityScore(impressions: number, position: number): number {
  const s = 35 + 15 * Math.log10(Math.max(1, impressions)) + (20 - position) * 1.5;
  return Math.max(1, Math.min(100, Math.round(s)));
}

function brandTokens(site: Site): string[] {
  const host = (() => {
    try {
      return new URL(site.url).hostname.replace(/^www\./, '').split('.')[0] ?? '';
    } catch {
      return '';
    }
  })();
  return [normalizeTerm(site.name), host.toLowerCase()].filter((t) => t.length >= 3);
}

/**
 * Consultas por las que el sitio ya aparece: actualiza las métricas de Search Console de las
 * keywords existentes y crea como oportunidad (source `gsc`) las que están entre las posiciones
 * 8 y 20, salvo las de marca y las que ya posiciona un artículo nuestro (eso es un refresco,
 * no un artículo nuevo: escribir otro lo canibalizaría).
 */
async function storeOpportunities(
  ctx: PipelineContext,
  site: Site,
  rows: SearchAnalyticsRow[],
  byUrl: Map<string, string>,
): Promise<{ queries: number; updated: number; created: number }> {
  const byTerm = new Map<string, QueryAgg>();
  for (const r of rows) {
    const [query, page = ''] = r.keys;
    if (!query) continue;
    const term = normalizeTerm(query);
    const cur = byTerm.get(term) ?? {
      term,
      clicks: 0,
      impressions: 0,
      posSum: 0,
      bestPage: page,
      bestPageImpressions: 0,
    };
    cur.clicks += r.clicks;
    cur.impressions += r.impressions;
    cur.posSum += r.position * r.impressions;
    if (r.impressions > cur.bestPageImpressions) {
      cur.bestPage = page;
      cur.bestPageImpressions = r.impressions;
    }
    byTerm.set(term, cur);
  }
  const scope = siteScope(ctx.prisma, site.id);
  const terms = [...byTerm.keys()];
  const existing = new Set<string>();
  let updated = 0;
  for (let i = 0; i < terms.length; i += 1000) {
    const found = await scope.keywords.findMany({
      where: { term: { in: terms.slice(i, i + 1000) } },
      select: { id: true, term: true },
    });
    for (const k of found) {
      existing.add(k.term);
      const q = byTerm.get(k.term);
      if (!q) continue;
      await scope.keywords.updateById(k.id, {
        gscClicks: q.clicks,
        gscImpressions: q.impressions,
        gscPosition: q.impressions ? q.posSum / q.impressions : null,
      });
      updated++;
    }
  }

  const brand = brandTokens(site);
  const candidates = [...byTerm.values()]
    .map((q) => ({ ...q, position: q.impressions ? q.posSum / q.impressions : 100 }))
    .filter(
      (q) =>
        !existing.has(q.term) &&
        q.term.includes(' ') &&
        q.term.length <= 100 &&
        q.impressions >= OPPORTUNITY_MIN_IMPRESSIONS &&
        q.position >= OPPORTUNITY_MIN_POSITION &&
        q.position <= OPPORTUNITY_MAX_POSITION &&
        !brand.some((b) => q.term.includes(b)) &&
        !byUrl.has(urlKey(q.bestPage)),
    )
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, MAX_NEW_OPPORTUNITIES);

  const created = await scope.keywords.createMany(
    candidates.map((q) => ({
      term: q.term,
      source: 'gsc',
      status: 'pending',
      score: opportunityScore(q.impressions, q.position),
      gscClicks: q.clicks,
      gscImpressions: q.impressions,
      gscPosition: q.position,
    })),
  );
  return { queries: byTerm.size, updated, created: created.count };
}

/** Marca (o desmarca) los artículos publicados que pierden clics. */
async function detectDecay(
  ctx: PipelineContext,
  site: Site,
  end: Date,
): Promise<{ flagged: number; recovered: number; refreshing: number }> {
  const siteId = site.id;
  const org = await ctx.prisma.organization.findUniqueOrThrow({
    where: { id: site.organizationId },
    select: { plan: true },
  });
  const autoRefresh = parseSettings(site.settings).autoRefresh && planFor(org.plan).contentRefresh;
  let refreshing = 0;
  const recentFrom = new Date(end.getTime() - (DECAY_WINDOW_DAYS - 1) * DAY);
  const prevFrom = new Date(recentFrom.getTime() - DECAY_WINDOW_DAYS * DAY);
  const sums = async (from: Date, to: Date) =>
    new Map(
      (
        await ctx.prisma.articleMetric.groupBy({
          by: ['articleId'],
          where: { siteId, date: { gte: from, lte: to } },
          _sum: { clicks: true },
        })
      ).map((r) => [r.articleId, r._sum.clicks ?? 0]),
    );
  const [recent, previous] = await Promise.all([
    sums(recentFrom, end),
    sums(prevFrom, new Date(recentFrom.getTime() - DAY)),
  ]);
  const scope = siteScope(ctx.prisma, siteId);
  const articles = await scope.articles.findMany({
    where: { remoteStatus: 'publish' },
    select: { id: true, decayDetectedAt: true },
  });
  let flagged = 0;
  let recovered = 0;
  for (const a of articles) {
    const before = previous.get(a.id) ?? 0;
    const after = recent.get(a.id) ?? 0;
    if (before < DECAY_MIN_BASE_CLICKS) continue;
    if (!a.decayDetectedAt && after < before * DECAY_RATIO) {
      await scope.articles.updateById(a.id, { decayDetectedAt: new Date() });
      flagged++;
      if (autoRefresh) {
        await ctx.dispatcher.enqueue('refresh', { siteId, refId: a.id }).catch(() => undefined);
        refreshing++;
      }
    } else if (a.decayDetectedAt && after >= before * RECOVERED_RATIO) {
      await scope.articles.updateById(a.id, { decayDetectedAt: null });
      recovered++;
    }
  }
  return { flagged, recovered, refreshing };
}

const METRICS_PER_SYNC = 300;

/**
 * Volumen y dificultad de las keywords pendientes que aún no los tienen (manuales, de Search
 * Console…). La puntuación se recalcula mezclando la de antes con la demanda.
 */
async function syncKeywordMetrics(ctx: PipelineContext, site: Site): Promise<unknown> {
  const provider = metricsProviderFor(ctx);
  if (!provider) return { skipped: 'NOT_CONFIGURED' };
  const scope = siteScope(ctx.prisma, site.id);
  const missing = await scope.keywords.findMany({
    where: { status: 'pending', volume: null },
    orderBy: { score: 'desc' },
    take: METRICS_PER_SYNC,
    select: { id: true, term: true, score: true },
  });
  if (!missing.length) return { updated: 0 };
  const metrics = await provider.getMetrics(
    missing.map((k) => k.term),
    { language: site.language, country: site.country },
  );
  let updated = 0;
  for (const k of missing) {
    const m = metrics.get(k.term);
    if (!m) continue;
    await scope.keywords.updateById(k.id, {
      volume: m.volume,
      difficulty: m.difficulty,
      cpc: m.cpc,
      score: blendScore(k.score, m),
    });
    updated++;
  }
  return { checked: missing.length, updated };
}

/**
 * Pedidos de WooCommerce cuya sesión empezó en un artículo (atribución nativa de WooCommerce 8.5+,
 * leída por el conector). Solo planes con `revenueAttribution`.
 */
async function syncOrders(ctx: PipelineContext, site: Site, now: Date): Promise<unknown> {
  const org = await ctx.prisma.organization.findUniqueOrThrow({
    where: { id: site.organizationId },
    select: { plan: true },
  });
  if (!planFor(org.plan).revenueAttribution) return { skipped: 'PLAN_FEATURE_REQUIRED' };
  const settings = parseSettings(site.settings);
  if (settings.woocommerce === false) return { skipped: 'NO_WOOCOMMERCE' };

  const after = settings.ordersSyncedAt
    ? daysAgo(new Date(settings.ordersSyncedAt), 1) // solape: pedidos que cambian de estado tarde
    : daysAgo(now, ORDERS_INITIAL_DAYS);
  const adapter = adapterFor(ctx, site);
  const byUrl = await articlesByUrl(ctx, site.id);
  let seen = 0;
  let attributed = 0;
  for (let page = 1; page <= MAX_ORDER_PAGES; page++) {
    const res = await adapter.listAttributedOrders(after, page);
    if (!res) return { skipped: 'NOT_SUPPORTED' };
    seen += res.orders.length;
    const data = res.orders
      .map((o) => ({ o, articleId: o.entry ? byUrl.get(urlKey(o.entry)) : undefined }))
      .filter((x): x is { o: (typeof res.orders)[number]; articleId: string } => !!x.articleId)
      .map(({ o, articleId }) => ({
        siteId: site.id,
        articleId,
        orderId: o.id,
        total: o.total,
        currency: o.currency,
        orderedAt: new Date(o.createdAt),
      }));
    if (data.length) {
      attributed += (await ctx.prisma.articleConversion.createMany({ data, skipDuplicates: true }))
        .count;
    }
    if (!res.hasMore) break;
  }
  const latest = parseSettings((await loadSite(ctx, site.id)).settings);
  await ctx.prisma.site.update({
    where: { id: site.id },
    data: { settings: { ...latest, ordersSyncedAt: now.toISOString() } },
  });
  return { seen, attributed };
}
