import { parseSettings } from '@seo/shared';
import { AppError, errorCode, notFound } from '../errors.js';
import { applyProductCards, countWords, sanitizeArticleHtml } from '../html.js';
import type { OutlineResult } from '../ai/prompts/outline.js';
import {
  writeSchema,
  writeSystem,
  writeToolDescription,
  writeUser,
  WRITE_PROMPT_VERSION,
  type InternalLink,
  type ProductOption,
} from '../ai/prompts/write.js';
import type { StoreProduct } from '../adapters/index.js';
import { siteScope } from '../tenant.js';
import { adapterFor, loadSite, modelFor, siteContext } from './common.js';
import type { PipelineContext, RunInfo } from './context.js';
import { runTracked } from './run-tracked.js';
import { recordUsage } from './usage.js';

const MAX_LINKS = 25;

/** max_tokens = palabras * 2.5 + 800, con techo de 8192. */
export function maxTokensFor(wordCount: number): number {
  return Math.min(8192, Math.round(wordCount * 2.5 + 800));
}

export function runWrite(ctx: PipelineContext, info: RunInfo): Promise<void> {
  const articleId = info.refId;
  return runTracked(
    ctx,
    info,
    async (tracker) => {
      if (!articleId)
        throw new AppError('VALIDATION_ERROR', 'write requires an articleId', { httpStatus: 400 });
      const site = await loadSite(ctx, info.siteId);
      const scope = siteScope(ctx.prisma, site.id);
      const article = await scope.articles.findById(articleId);
      if (!article) throw notFound('Article');

      // Idempotencia: ya redactado y listo → solo cerrar la cadena.
      if (article.contentHtml && (article.status === 'ready' || article.status === 'published')) {
        if (article.keywordId)
          await scope.keywords.updateById(article.keywordId, { status: 'done' });
        return { meta: { skipped: true } };
      }
      if (!article.outline) {
        throw new AppError('INVALID_STATE', 'Article has no outline', { httpStatus: 409 });
      }

      await scope.articles.updateById(article.id, { status: 'writing' });
      if (article.keywordId)
        await scope.keywords.updateById(article.keywordId, { status: 'processing' });

      const keyword = article.keywordId ? await scope.keywords.findById(article.keywordId) : null;
      const settings = parseSettings(site.settings);

      // Enlazado interno: solo URLs reales del sitio. Si el sitio no responde seguimos sin enlaces y lo anotamos.
      const links: InternalLink[] = [];
      let linksWarning: string | undefined;
      // Artículos publicados del mismo cluster (la pilar primero): el enlazado temático refuerza el tema.
      let pillar: InternalLink | null = null;
      if (keyword?.clusterId) {
        const cluster = await ctx.prisma.keywordCluster.findFirst({
          where: { id: keyword.clusterId, siteId: site.id },
        });
        const siblings = await scope.articles.findMany({
          where: {
            id: { not: article.id },
            remoteStatus: 'publish',
            keyword: { clusterId: keyword.clusterId },
          },
          select: { title: true, remoteUrl: true, keywordId: true },
          take: 10,
        });
        for (const s of siblings) {
          if (!s.remoteUrl) continue;
          const link = { title: s.title, url: s.remoteUrl };
          if (s.keywordId && s.keywordId === cluster?.pillarKeywordId) pillar = link;
          else links.push(link);
        }
        if (pillar) links.unshift(pillar);
      }
      try {
        const content = await adapterFor(ctx, site).listContent(MAX_LINKS);
        const seen = new Set(links.map((l) => l.url));
        links.push(
          ...content.filter((c) => !seen.has(c.url)).map((c) => ({ title: c.title, url: c.url })),
        );
      } catch (err) {
        linksWarning = errorCode(err);
        ctx.log.warn({ siteId: site.id, code: linksWarning }, 'internal links unavailable');
      }

      // Productos de la tienda que el artículo puede recomendar (tarjeta con precio y compra).
      let products: StoreProduct[] = [];
      if (settings.productCards && settings.woocommerce !== false) {
        try {
          products = await adapterFor(ctx, site).searchProducts(keyword?.term ?? article.title, 8);
        } catch (err) {
          ctx.log.warn({ siteId: site.id, code: errorCode(err) }, 'store products unavailable');
        }
      }

      const outline = article.outline as unknown as OutlineResult;
      const result = await ctx.claude.callTool({
        model: modelFor(ctx, site),
        system: writeSystem(siteContext(site)),
        user: writeUser({
          keyword: keyword?.term ?? article.title,
          outline,
          wordCount: settings.wordCount,
          links,
          pillar,
          products: products.map((p): ProductOption => ({
            id: p.id,
            name: p.name,
            url: p.url,
            price: p.price,
          })),
        }),
        maxTokens: maxTokensFor(settings.wordCount),
        toolDescription: writeToolDescription,
        schema: writeSchema,
      });
      await tracker.add(result.model, result.usage);

      const allowed = new Set(links.map((l) => l.url));
      const cards = applyProductCards(
        sanitizeArticleHtml(result.data.contentHtml, allowed),
        new Set(products.map((p) => p.id)),
      );
      const html = cards.html;
      const wordCount = countWords(html);
      const featured = cards.productIds
        .map((id) => products.find((p) => p.id === id)?.imageId)
        .find((id): id is number => typeof id === 'number');

      await scope.articles.updateById(article.id, {
        contentHtml: html,
        wordCount,
        status: 'ready',
        ...(featured ? { featuredMediaId: featured } : {}),
      });
      if (article.keywordId) await scope.keywords.updateById(article.keywordId, { status: 'done' });
      await recordUsage(ctx.prisma, site.id, { articles: 1 });

      if (info.chain === 'publish') {
        await ctx.dispatcher.enqueue('publish', { siteId: site.id, refId: article.id });
      }
      return {
        meta: {
          articleId: article.id,
          wordCount,
          links: links.length,
          linksWarning,
          products: cards.productIds,
          prompt: WRITE_PROMPT_VERSION,
        },
      };
    },
    {
      onFailure: async (_err, willRetry) => {
        if (!articleId) return;
        const scope = siteScope(ctx.prisma, info.siteId);
        const article = await scope.articles.findById(articleId);
        if (!article) return;
        await scope.articles
          .updateById(article.id, { status: willRetry ? 'draft' : 'failed' })
          .catch(() => undefined);
        if (article.keywordId) {
          await scope.keywords
            .updateById(article.keywordId, { status: willRetry ? 'queued' : 'failed' })
            .catch(() => undefined);
        }
      },
    },
  );
}
