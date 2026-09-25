import type { Article } from '@seo/db';
import { parseSettings } from '@seo/shared';
import {
  backlinkSchema,
  backlinkSystem,
  backlinkToolDescription,
  backlinkUser,
  BACKLINK_PROMPT_VERSION,
} from '../ai/prompts/backlink.js';
import { AppError, errorCode, notFound } from '../errors.js';
import {
  extractLinks,
  listParagraphs,
  replaceParagraph,
  validateLinkedParagraph,
} from '../html.js';
import { similarity } from '../keywords/similarity.js';
import { siteScope } from '../tenant.js';
import { adapterFor, loadSite, modelFor, siteContext } from './common.js';
import type { PipelineContext, RunInfo } from './context.js';
import { runTracked } from './run-tracked.js';

const MAX_SOURCES = 3;
const MIN_RELATEDNESS = 0.15;
const MIN_PARAGRAPH_WORDS = 20;
const MAX_PARAGRAPHS = 40;

/** Visible para los lectores: publicado en WordPress y con su URL definitiva. */
export function isLive(
  a: Pick<Article, 'remoteStatus' | 'remoteUrl' | 'status'>,
  autoPublish: boolean,
): boolean {
  if (!a.remoteUrl || a.remoteUrl.includes('?p=')) return false;
  return (
    a.remoteStatus === 'publish' ||
    (a.remoteStatus === null && a.status === 'published' && autoPublish)
  );
}

/**
 * Enlazado inverso: cuando un artículo se publica, añade un enlace hacia él en hasta 3 artículos
 * antiguos relacionados (mismo cluster primero, después por similitud). Solo se reescribe un
 * párrafo, validado para que conserve su texto y sus enlaces, y se actualiza también en WordPress.
 */
export function runBacklink(ctx: PipelineContext, info: RunInfo): Promise<void> {
  return runTracked(ctx, info, async (tracker) => {
    if (!info.refId) {
      throw new AppError('VALIDATION_ERROR', 'backlink requires an articleId', { httpStatus: 400 });
    }
    const site = await loadSite(ctx, info.siteId);
    const settings = parseSettings(site.settings);
    const scope = siteScope(ctx.prisma, site.id);
    const target = await scope.articles.findById(info.refId);
    if (!target) throw notFound('Article');
    if (!isLive(target, settings.autoPublish) || !target.remoteUrl) {
      return { meta: { skipped: 'TARGET_NOT_LIVE' } };
    }
    const targetUrl = target.remoteUrl;
    const targetKeyword = target.keywordId ? await scope.keywords.findById(target.keywordId) : null;

    const already = new Set(
      (
        await ctx.prisma.internalLink.findMany({
          where: { siteId: site.id, toArticleId: target.id },
          select: { fromArticleId: true },
        })
      ).map((l) => l.fromArticleId),
    );
    const others = await ctx.prisma.article.findMany({
      where: {
        siteId: site.id,
        id: { not: target.id },
        contentHtml: { not: null },
        remotePostId: { not: null },
      },
      include: { keyword: { select: { term: true, clusterId: true } } },
    });
    const targetText = `${targetKeyword?.term ?? ''} ${target.title}`;
    const candidates = others
      .filter((a) => isLive(a, settings.autoPublish) && !already.has(a.id))
      .filter((a) => !extractLinks(a.contentHtml ?? '').includes(targetUrl))
      .map((a) => ({
        article: a,
        sameCluster: !!targetKeyword?.clusterId && a.keyword?.clusterId === targetKeyword.clusterId,
        score: similarity(targetText, `${a.keyword?.term ?? ''} ${a.title}`),
      }))
      .filter((c) => c.sameCluster || c.score >= MIN_RELATEDNESS)
      .sort((a, b) => Number(b.sameCluster) - Number(a.sameCluster) || b.score - a.score)
      .slice(0, MAX_SOURCES);

    const adapter = adapterFor(ctx, site);
    const linked: string[] = [];
    const rejected: string[] = [];
    for (const { article } of candidates) {
      const html = article.contentHtml ?? '';
      const paragraphs = listParagraphs(html)
        .filter((p) => p.words >= MIN_PARAGRAPH_WORDS && !p.html.includes('[products'))
        .slice(0, MAX_PARAGRAPHS);
      if (!paragraphs.length) continue;

      const result = await ctx.claude.callTool({
        model: modelFor(ctx, site),
        system: backlinkSystem(siteContext(site)),
        user: backlinkUser({
          target: { title: target.title, url: targetUrl, keyword: targetKeyword?.term ?? null },
          paragraphs: paragraphs.map((p) => ({ index: p.index, html: p.html })),
        }),
        maxTokens: 1500,
        toolDescription: backlinkToolDescription,
        schema: backlinkSchema,
      });
      await tracker.add(result.model, result.usage);

      const chosen = paragraphs.find((p) => p.index === result.data.paragraphIndex);
      const replacement = chosen
        ? validateLinkedParagraph(chosen.html, result.data.paragraphHtml, targetUrl)
        : null;
      if (!chosen || !replacement) {
        rejected.push(article.id);
        continue;
      }
      const updated = replaceParagraph(html, chosen, replacement);
      try {
        // Primero WordPress: si falla, el artículo local no cambia y se puede reintentar.
        await adapter.updatePost(article.remotePostId as number, { content: updated });
      } catch (err) {
        ctx.log.warn(
          { siteId: site.id, articleId: article.id, code: errorCode(err) },
          'backlink update failed',
        );
        rejected.push(article.id);
        continue;
      }
      await scope.articles.updateById(article.id, { contentHtml: updated });
      await ctx.prisma.internalLink.create({
        data: {
          siteId: site.id,
          fromArticleId: article.id,
          toArticleId: target.id,
          anchor: result.data.anchorText.slice(0, 200),
        },
      });
      linked.push(article.id);
    }
    return {
      meta: {
        candidates: candidates.length,
        linked,
        rejected,
        prompt: BACKLINK_PROMPT_VERSION,
      },
    };
  });
}
