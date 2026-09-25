import type { Article, Prisma } from '@seo/db';
import type {
  ArticleDto,
  ArticleQuery,
  EnqueuedDto,
  Paginated,
  PatchArticleInput,
} from '@seo/shared';
import { AppError } from '../errors.js';
import { countWords, sanitizeArticleHtml } from '../html.js';
import { requireArticle, requireSite, siteScope } from '../tenant.js';
import type { CoreDeps } from './deps.js';
import { toArticleDto } from './mappers.js';

export async function listArticles(
  deps: CoreDeps,
  organizationId: string,
  siteId: string,
  q: ArticleQuery,
): Promise<Paginated<Article>> {
  await requireSite(deps.prisma, organizationId, siteId);
  const scope = siteScope(deps.prisma, siteId);
  const where: Prisma.ArticleWhereInput = q.status ? { status: q.status } : {};
  const [items, total] = await Promise.all([
    scope.articles.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
    scope.articles.count(where),
  ]);
  return { items, page: q.page, pageSize: q.pageSize, total };
}

export function getArticle(deps: CoreDeps, organizationId: string, id: string): Promise<Article> {
  return requireArticle(deps.prisma, organizationId, id);
}

/** Artículo listo para el editor: con su keyword objetivo. */
export async function getArticleDto(
  deps: CoreDeps,
  organizationId: string,
  id: string,
): Promise<ArticleDto> {
  const article = await requireArticle(deps.prisma, organizationId, id);
  const keyword = article.keywordId
    ? await siteScope(deps.prisma, article.siteId).keywords.findById(article.keywordId)
    : null;
  return toArticleDto(article, keyword?.term ?? null);
}

export async function patchArticle(
  deps: CoreDeps,
  organizationId: string,
  id: string,
  input: PatchArticleInput,
): Promise<Article> {
  const article = await requireArticle(deps.prisma, organizationId, id);
  if (article.status === 'writing' || article.status === 'publishing') {
    throw new AppError('INVALID_STATE', `Article is ${article.status}`, { httpStatus: 409 });
  }
  const data: Prisma.ArticleUpdateManyMutationInput = {};
  if (input.title !== undefined) data.title = input.title;
  if (input.slug !== undefined) data.slug = input.slug;
  if (input.metaDescription !== undefined) data.metaDescription = input.metaDescription;
  if (input.contentHtml !== undefined) {
    const html = sanitizeArticleHtml(input.contentHtml);
    data.contentHtml = html;
    data.wordCount = countWords(html);
    if (article.status === 'draft' && html) data.status = 'ready';
  }
  const scope = siteScope(deps.prisma, article.siteId);
  await scope.articles.updateById(article.id, data);
  return requireArticle(deps.prisma, organizationId, id);
}

export async function deleteArticle(
  deps: CoreDeps,
  organizationId: string,
  id: string,
): Promise<void> {
  const article = await requireArticle(deps.prisma, organizationId, id);
  await siteScope(deps.prisma, article.siteId).articles.deleteById(article.id);
}

export async function publishArticle(
  deps: CoreDeps,
  organizationId: string,
  id: string,
): Promise<EnqueuedDto> {
  const article = await requireArticle(deps.prisma, organizationId, id);
  if (!article.contentHtml) {
    throw new AppError('INVALID_STATE', 'Article has no content', { httpStatus: 409 });
  }
  if (article.status === 'writing' || article.status === 'publishing') {
    throw new AppError('INVALID_STATE', `Article is ${article.status}`, { httpStatus: 409 });
  }
  const scope = siteScope(deps.prisma, article.siteId);
  await scope.articles.updateById(article.id, { status: 'publishing' });
  try {
    return await deps.dispatcher.enqueue('publish', { siteId: article.siteId, refId: article.id });
  } catch (err) {
    await scope.articles.updateById(article.id, { status: article.status });
    throw err;
  }
}

export async function regenerateArticle(
  deps: CoreDeps,
  organizationId: string,
  id: string,
): Promise<EnqueuedDto> {
  const article = await requireArticle(deps.prisma, organizationId, id);
  if (!article.outline) {
    throw new AppError('INVALID_STATE', 'Article has no outline to regenerate from', {
      httpStatus: 409,
    });
  }
  if (article.status === 'writing' || article.status === 'publishing') {
    throw new AppError('INVALID_STATE', `Article is ${article.status}`, { httpStatus: 409 });
  }
  const scope = siteScope(deps.prisma, article.siteId);
  await scope.articles.updateById(article.id, { contentHtml: null, wordCount: 0, status: 'draft' });
  try {
    return await deps.dispatcher.enqueue('write', {
      siteId: article.siteId,
      refId: article.id,
      chain: 'ready',
    });
  } catch (err) {
    await scope.articles.updateById(article.id, {
      contentHtml: article.contentHtml,
      wordCount: article.wordCount,
      status: article.status,
    });
    throw err;
  }
}
