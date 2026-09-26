import { parseSettings } from '@seo/shared';
import { AppError, notFound } from '../errors.js';
import { extractFaq } from '../html.js';
import { buildArticleSchema } from '../seo/schema.js';
import { siteScope } from '../tenant.js';
import { adapterFor, loadSite } from './common.js';
import type { PipelineContext, RunInfo } from './context.js';
import { runTracked } from './run-tracked.js';

export function runPublish(ctx: PipelineContext, info: RunInfo): Promise<void> {
  const articleId = info.refId;
  return runTracked(
    ctx,
    info,
    async () => {
      if (!articleId)
        throw new AppError('VALIDATION_ERROR', 'publish requires an articleId', {
          httpStatus: 400,
        });
      const site = await loadSite(ctx, info.siteId);
      const scope = siteScope(ctx.prisma, site.id);
      const article = await scope.articles.findById(articleId);
      if (!article) throw notFound('Article');
      if (!article.contentHtml) {
        throw new AppError('INVALID_STATE', 'Article has no content to publish', {
          httpStatus: 409,
        });
      }

      // Idempotencia ante reintentos: un reintento tras haber publicado (sin cambios posteriores) no repite nada.
      if (
        info.attempt > 1 &&
        article.status === 'published' &&
        article.remotePostId &&
        article.publishedAt &&
        article.updatedAt.getTime() - article.publishedAt.getTime() < 5000
      ) {
        return { meta: { skipped: true, remotePostId: article.remotePostId } };
      }

      await scope.articles.updateById(article.id, { status: 'publishing' });

      const settings = parseSettings(site.settings);
      const keyword = article.keywordId ? await scope.keywords.findById(article.keywordId) : null;
      // Lo que ya está publicado en WordPress sigue publicado al actualizarlo; lo programado sale
      // publicado al llegar su fecha; el resto, según la publicación automática.
      const status =
        info.wpStatus ??
        (settings.autoPublish || article.remoteStatus === 'publish' || article.scheduledFor
          ? 'publish'
          : 'draft');
      const schemaJson = buildArticleSchema({
        title: article.title,
        description: article.metaDescription,
        url: article.remoteUrl && !article.remoteUrl.includes('?p=') ? article.remoteUrl : null,
        faq: extractFaq(article.contentHtml),
        siteName: site.name,
        siteUrl: site.url,
        language: site.language,
        includeArticle: settings.seoPlugin === null,
        publishedAt: article.publishedAt,
        updatedAt: article.updatedAt,
      });
      const input = {
        title: article.title,
        content: article.contentHtml,
        slug: article.slug,
        status,
        categoryId: settings.categoryId,
        authorId: settings.authorId,
        featuredMediaId: article.featuredMediaId,
        ...(article.metaDescription ? { excerpt: article.metaDescription } : {}),
        seo: {
          ...(keyword ? { focusKeyword: keyword.term } : {}),
          ...(article.metaDescription ? { metaDescription: article.metaDescription } : {}),
          title: article.title,
          ...(schemaJson ? { schemaJson } : {}),
        },
      } as const;

      const adapter = adapterFor(ctx, site);
      let remoteId: number;
      let remoteUrl: string;
      let warnings: string[];
      if (article.remotePostId) {
        const res = await adapter.updatePost(article.remotePostId, input);
        warnings = (res && 'warnings' in res ? res.warnings : undefined) ?? [];
        remoteId = article.remotePostId;
        remoteUrl = article.remoteUrl ?? '';
      } else {
        const res = await adapter.createPost(input);
        warnings = res.warnings ?? [];
        remoteId = res.id;
        remoteUrl = res.url;
      }

      const now = new Date();
      await ctx.prisma.article.updateMany({
        where: { id: article.id, siteId: site.id },
        data: {
          status: 'published',
          remotePostId: remoteId,
          remoteUrl,
          publishedAt: now,
          ...(status === 'publish' ? { remoteStatus: 'publish' } : {}),
        },
      });

      // Recuerda si Yoast expone su meta para avisar en la UI.
      if (article.metaDescription) {
        const exposed = !warnings.includes('YOAST_META_NOT_EXPOSED');
        if (settings.yoastMetaExposed !== exposed) {
          await ctx.prisma.site.update({
            where: { id: site.id },
            data: { settings: { ...settings, yoastMetaExposed: exposed } },
          });
        }
      }
      // Publicado de verdad (no borrador): enlazarlo desde artículos antiguos relacionados.
      const backlinks = status === 'publish' && settings.autoBacklinks;
      if (backlinks) {
        await ctx.dispatcher
          .enqueue('backlink', { siteId: site.id, refId: article.id })
          .catch(() => undefined);
      }
      return {
        meta: { remotePostId: remoteId, remoteUrl, wpStatus: status, warnings, backlinks },
      };
    },
    {
      onFailure: async (_err, willRetry) => {
        if (!articleId) return;
        await siteScope(ctx.prisma, info.siteId)
          .articles.updateById(articleId, { status: willRetry ? 'ready' : 'failed' })
          .catch(() => undefined);
      },
    },
  );
}
