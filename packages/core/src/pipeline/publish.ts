import { parseSettings } from '@seo/shared';
import { AppError, notFound } from '../errors.js';
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
      const status = settings.autoPublish ? 'publish' : 'draft';
      const input = {
        title: article.title,
        content: article.contentHtml,
        slug: article.slug,
        status,
        categoryId: settings.categoryId,
        ...(article.metaDescription ? { excerpt: article.metaDescription } : {}),
        seo: {
          ...(keyword ? { focusKeyword: keyword.term } : {}),
          ...(article.metaDescription ? { metaDescription: article.metaDescription } : {}),
          title: article.title,
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
      return { meta: { remotePostId: remoteId, remoteUrl, wpStatus: status, warnings } };
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
