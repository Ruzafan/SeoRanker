import { parseSettings } from '@seo/shared';
import { AppError, notFound } from '../errors.js';
import { slugify, truncateAtWord } from '../html.js';
import {
  outlineSchema,
  outlineSystem,
  outlineToolDescription,
  outlineUser,
  OUTLINE_PROMPT_VERSION,
} from '../ai/prompts/outline.js';
import { fetchSerp, medianWordCount, type SerpSnapshot } from '../keywords/serp.js';
import { findCannibal, type Target } from '../keywords/similarity.js';
import { errorCode } from '../errors.js';
import { siteScope } from '../tenant.js';
import { adapterFor, loadSite, modelFor, siteContext } from './common.js';
import type { PipelineContext, RunInfo } from './context.js';
import { runTracked } from './run-tracked.js';

export function runOutline(ctx: PipelineContext, info: RunInfo): Promise<void> {
  const keywordId = info.refId;
  return runTracked(
    ctx,
    info,
    async (tracker) => {
      if (!keywordId)
        throw new AppError('VALIDATION_ERROR', 'outline requires a keywordId', { httpStatus: 400 });
      const site = await loadSite(ctx, info.siteId);
      const scope = siteScope(ctx.prisma, site.id);
      const keyword = await scope.keywords.findById(keywordId);
      if (!keyword) throw notFound('Keyword');
      if (keyword.status === 'discarded') {
        throw new AppError('INVALID_STATE', 'Keyword is discarded', { httpStatus: 409 });
      }

      // Idempotencia: si ya hay artículo para esta keyword no se genera otro esquema.
      const existing = await scope.articles.findByKeyword(keyword.id);
      if (existing?.outline) {
        if (existing.status === 'ready' || existing.status === 'published') {
          await scope.keywords.updateById(keyword.id, { status: 'done' });
          return { meta: { skipped: true, articleId: existing.id } };
        }
        await scope.keywords.updateById(keyword.id, { status: 'processing' });
        await ctx.dispatcher.enqueue('write', {
          siteId: site.id,
          refId: existing.id,
          chain: info.chain,
        });
        return { meta: { skipped: true, articleId: existing.id, resumed: true } };
      }

      // Canibalización: si ya hay un artículo (nuestro o del blog) para la misma intención, no se
      // escribe otro que competiría con él. El usuario puede forzarlo recuperando la keyword.
      if (!keyword.allowSimilar) {
        const ours = await ctx.prisma.article.findMany({
          where: { siteId: site.id, OR: [{ keywordId: null }, { keywordId: { not: keyword.id } }] },
          select: { id: true, title: true, keyword: { select: { term: true } } },
        });
        const targets: Target[] = ours.map((a) => ({
          id: a.id,
          texts: [a.title, ...(a.keyword ? [a.keyword.term] : [])],
        }));
        try {
          const blog = await adapterFor(ctx, site).listContent(60);
          blog
            .filter((c) => c.type === 'post')
            .forEach((c) => targets.push({ id: `wp:${c.url}`, texts: [c.title] }));
        } catch (err) {
          ctx.log.warn(
            { siteId: site.id, code: errorCode(err) },
            'blog posts unavailable for cannibalization check',
          );
        }
        const clash = findCannibal(keyword.term, targets);
        if (clash) {
          await scope.keywords.updateById(keyword.id, {
            status: 'discarded',
            discardReason: 'CANNIBALIZATION',
            similarToArticleId: clash.id.startsWith('wp:') ? null : clash.id,
          });
          return {
            meta: { skipped: 'CANNIBALIZATION', similarTo: clash.id, similarText: clash.texts[0] },
          };
        }
      }

      await scope.keywords.updateById(keyword.id, { status: 'processing' });
      const settings = parseSettings(site.settings);
      // Qué posiciona hoy en Google para esta keyword (si hay SERPAPI_KEY). Sin SERP se planifica igual.
      let serp: SerpSnapshot | null = null;
      if (ctx.config.serpApiKey) {
        serp = await fetchSerp(
          ctx.config.serpApiKey,
          keyword.term,
          { language: site.language, country: site.country },
          { fetchFn: ctx.fetchFn ?? fetch, allowPrivateHosts: ctx.config.allowPrivateHosts },
        );
      }
      const result = await ctx.claude.callTool({
        model: modelFor(ctx, site),
        system: outlineSystem(siteContext(site)),
        user: outlineUser({
          keyword: keyword.term,
          intent: keyword.intent,
          wordCount: settings.wordCount,
          serp: serp ? { snapshot: serp, medianWords: medianWordCount(serp) } : null,
        }),
        maxTokens: 3000,
        toolDescription: outlineToolDescription,
        schema: outlineSchema,
      });
      await tracker.add(result.model, result.usage);

      const o = result.data;
      const title = truncateAtWord(o.title.trim(), 70);
      const article = await scope.articles.create({
        keywordId: keyword.id,
        title,
        slug: slugify(o.slug) || slugify(title),
        metaDescription: truncateAtWord(o.metaDescription.trim(), 155),
        outline: o as never,
        ...(serp ? { serp: serp as never } : {}),
        status: 'draft',
      });
      await ctx.dispatcher.enqueue('write', {
        siteId: site.id,
        refId: article.id,
        chain: info.chain,
      });
      return {
        meta: {
          articleId: article.id,
          serpResults: serp?.results.length ?? 0,
          prompt: OUTLINE_PROMPT_VERSION,
        },
      };
    },
    {
      onFailure: async (_err, willRetry) => {
        if (!keywordId) return;
        await siteScope(ctx.prisma, info.siteId)
          .keywords.updateById(keywordId, {
            status: willRetry ? 'queued' : 'failed',
          })
          .catch(() => undefined);
      },
    },
  );
}
