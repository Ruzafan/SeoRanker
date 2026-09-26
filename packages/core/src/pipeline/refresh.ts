import type { Site } from '@seo/db';
import { parseSettings, planFor } from '@seo/shared';
import {
  refreshSchema,
  refreshSystem,
  refreshToolDescription,
  refreshUser,
  REFRESH_PROMPT_VERSION,
  type PageQuery,
} from '../ai/prompts/refresh.js';
import { decryptJson } from '../crypto.js';
import { AppError, errorCode, notFound } from '../errors.js';
import { countWords, extractLinks, sanitizeArticleHtml } from '../html.js';
import { GoogleClient } from '../integrations/google.js';
import { fetchSerp, medianWordCount, type SerpSnapshot } from '../keywords/serp.js';
import { siteScope } from '../tenant.js';
import { adapterFor, loadSite, modelFor, siteContext } from './common.js';
import type { PipelineContext, RunInfo } from './context.js';
import { assertQuota } from './quota.js';
import { runTracked } from './run-tracked.js';
import { isoDate } from './sync.js';
import { recordUsage } from './usage.js';
import { maxTokensFor } from './write.js';

const DAY = 86_400_000;
const MAX_QUERIES = 25;

/** Consultas reales por las que ya aparece la página en Google (últimos 28 días). */
async function pageQueries(ctx: PipelineContext, site: Site, url: string): Promise<PageQuery[]> {
  if (!ctx.config.google) return [];
  const conn = await ctx.prisma.searchConsoleConnection.findUnique({ where: { siteId: site.id } });
  if (!conn?.propertyUrl) return [];
  const google = new GoogleClient(ctx.config.google, ctx.fetchFn);
  const { refreshToken } = decryptJson<{ refreshToken: string }>(
    ctx.encryptionKey,
    conn.credentials,
  );
  const token = await google.accessToken(refreshToken);
  const end = new Date(Date.now() - 2 * DAY);
  const rows = await google.searchAnalytics(
    token,
    conn.propertyUrl,
    {
      startDate: isoDate(new Date(end.getTime() - 27 * DAY)),
      endDate: isoDate(end),
      dimensions: ['query'],
      dimensionFilterGroups: [
        { filters: [{ dimension: 'page', operator: 'equals', expression: url }] },
      ],
    },
    200,
  );
  return rows
    .filter((r) => r.keys[0])
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, MAX_QUERIES)
    .map((r) => ({
      query: r.keys[0] as string,
      impressions: r.impressions,
      clicks: r.clicks,
      position: r.position,
    }));
}

/**
 * Refresco de un artículo publicado que pierde tráfico: se reescribe con lo que posiciona hoy y con
 * las búsquedas reales de la página, conservando URL, título, enlaces y tarjetas de producto. La
 * versión anterior se guarda para poder deshacerlo. Si estaba en WordPress, se vuelve a publicar
 * (salvo que el sitio exija aprobación: entonces queda pendiente de revisión).
 */
export function runRefresh(ctx: PipelineContext, info: RunInfo): Promise<void> {
  return runTracked(ctx, info, async (tracker) => {
    if (!info.refId)
      throw new AppError('VALIDATION_ERROR', 'refresh requires an articleId', { httpStatus: 400 });
    const site = await loadSite(ctx, info.siteId);
    const org = await ctx.prisma.organization.findUniqueOrThrow({
      where: { id: site.organizationId },
      select: { plan: true },
    });
    if (!planFor(org.plan).contentRefresh) {
      throw new AppError('PLAN_FEATURE_REQUIRED', 'Content refresh is not included in this plan', {
        httpStatus: 402,
      });
    }
    const settings = parseSettings(site.settings);
    const scope = siteScope(ctx.prisma, site.id);
    const article = await scope.articles.findById(info.refId);
    if (!article) throw notFound('Article');
    if (!article.contentHtml)
      throw new AppError('INVALID_STATE', 'Article has no content', { httpStatus: 409 });
    await assertQuota(ctx.prisma, site.id, 'generate_article', ctx.config);

    const keyword = article.keywordId ? await scope.keywords.findById(article.keywordId) : null;
    const term = keyword?.term ?? article.title;

    let serp: SerpSnapshot | null = null;
    if (ctx.config.serpApiKey) {
      serp = await fetchSerp(
        ctx.config.serpApiKey,
        term,
        { language: site.language, country: site.country },
        { fetchFn: ctx.fetchFn ?? fetch, allowPrivateHosts: ctx.config.allowPrivateHosts },
      );
    }
    let queries: PageQuery[] = [];
    if (article.remoteUrl && !article.remoteUrl.includes('?p=')) {
      try {
        queries = await pageQueries(ctx, site, article.remoteUrl);
      } catch (err) {
        ctx.log.warn({ siteId: site.id, code: errorCode(err) }, 'page queries unavailable');
      }
    }

    const targetWords = Math.max(article.wordCount, settings.wordCount);
    const result = await ctx.claude.callTool({
      model: modelFor(ctx, site),
      system: refreshSystem(siteContext(site)),
      user: refreshUser({
        keyword: term,
        title: article.title,
        html: article.contentHtml,
        wordCount: targetWords,
        serp: serp ? { snapshot: serp, medianWords: medianWordCount(serp) } : null,
        queries,
      }),
      maxTokens: maxTokensFor(targetWords + 300),
      toolDescription: refreshToolDescription,
      schema: refreshSchema,
    });
    await tracker.add(result.model, result.usage);

    // Enlaces permitidos: los que ya tenía y las páginas reales del sitio.
    const allowed = new Set(extractLinks(article.contentHtml));
    try {
      (await adapterFor(ctx, site).listContent(25)).forEach((c) => allowed.add(c.url));
    } catch {
      // Sin la lista del sitio se conservan al menos los enlaces que ya tenía.
    }
    const html = sanitizeArticleHtml(result.data.contentHtml, allowed);
    const needsReview = settings.requireApproval;
    const republish = !!article.remotePostId && !needsReview;

    await scope.articles.updateById(article.id, {
      previousContentHtml: article.contentHtml,
      contentHtml: html,
      wordCount: countWords(html),
      refreshedAt: new Date(),
      decayDetectedAt: null,
      ...(serp ? { serp: serp as never } : {}),
      status: 'ready',
      ...(needsReview ? { reviewStatus: 'pending' } : {}),
    });
    await recordUsage(ctx.prisma, site.id, { articles: 1 });
    if (republish) await ctx.dispatcher.enqueue('publish', { siteId: site.id, refId: article.id });

    return {
      meta: {
        articleId: article.id,
        changes: result.data.changes.slice(0, 8),
        queries: queries.length,
        serpResults: serp?.results.length ?? 0,
        republish,
        prompt: REFRESH_PROMPT_VERSION,
      },
    };
  });
}
