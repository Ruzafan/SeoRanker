import type { Article, Prisma } from '@seo/db';
import {
  parseSettings,
  planFor,
  type ArticleDto,
  type ArticleQuery,
  type ArticleSummaryDto,
  type CommentDto,
  type EnqueuedDto,
  type Paginated,
  type PatchArticleInput,
  type PublishArticleInput,
  type ReviewInput,
} from '@seo/shared';
import { AppError } from '../errors.js';
import { countWords, sanitizeArticleHtml } from '../html.js';
import { requireArticle, requireSite, siteScope } from '../tenant.js';
import type { CoreDeps } from './deps.js';
import { toArticleDto, toArticleSummary } from './mappers.js';

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
  if (input.scheduledFor !== undefined) {
    data.scheduledFor = input.scheduledFor ? new Date(input.scheduledFor) : null;
  }
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
  input: PublishArticleInput = {},
): Promise<EnqueuedDto> {
  const article = await requireArticle(deps.prisma, organizationId, id);
  if (!article.contentHtml) {
    throw new AppError('INVALID_STATE', 'Article has no content', { httpStatus: 409 });
  }
  if (article.status === 'writing' || article.status === 'publishing') {
    throw new AppError('INVALID_STATE', `Article is ${article.status}`, { httpStatus: 409 });
  }
  // Un borrador no sale al público: no necesita la aprobación del cliente.
  if (input.status !== 'draft') await assertApproved(deps, article);
  const scope = siteScope(deps.prisma, article.siteId);
  await scope.articles.updateById(article.id, { status: 'publishing' });
  try {
    return await deps.dispatcher.enqueue('publish', {
      siteId: article.siteId,
      refId: article.id,
      wpStatus: input.status,
    });
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

/** Con aprobación obligatoria, no se publica nada que el cliente no haya aprobado. */
async function assertApproved(deps: CoreDeps, article: Article): Promise<void> {
  const site = await deps.prisma.site.findUniqueOrThrow({ where: { id: article.siteId } });
  if (parseSettings(site.settings).requireApproval && article.reviewStatus !== 'approved') {
    throw new AppError('APPROVAL_REQUIRED', 'The article needs client approval before publishing', {
      httpStatus: 409,
    });
  }
}

/** Refresca un artículo que pierde tráfico (plan con contentRefresh). */
export async function refreshArticle(
  deps: CoreDeps,
  organizationId: string,
  id: string,
): Promise<EnqueuedDto> {
  const article = await requireArticle(deps.prisma, organizationId, id);
  const org = await deps.prisma.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { plan: true },
  });
  if (!planFor(org.plan).contentRefresh) {
    throw new AppError('PLAN_FEATURE_REQUIRED', 'Content refresh is not included in this plan', {
      httpStatus: 402,
    });
  }
  if (!article.contentHtml || article.status === 'writing' || article.status === 'publishing') {
    throw new AppError('INVALID_STATE', `Article is ${article.status}`, { httpStatus: 409 });
  }
  return deps.dispatcher.enqueue('refresh', { siteId: article.siteId, refId: article.id });
}

/** Deshace el último refresco: vuelve a la versión anterior (y guarda la actual como anterior). */
export async function restorePreviousVersion(
  deps: CoreDeps,
  organizationId: string,
  id: string,
): Promise<Article> {
  const article = await requireArticle(deps.prisma, organizationId, id);
  if (
    !article.previousContentHtml ||
    article.status === 'writing' ||
    article.status === 'publishing'
  ) {
    throw new AppError('INVALID_STATE', 'There is no previous version to restore', {
      httpStatus: 409,
    });
  }
  await siteScope(deps.prisma, article.siteId).articles.updateById(article.id, {
    contentHtml: article.previousContentHtml,
    previousContentHtml: article.contentHtml,
    wordCount: countWords(article.previousContentHtml),
    status: 'ready',
  });
  return requireArticle(deps.prisma, organizationId, id);
}

/**
 * Revisión del cliente (o del equipo): aprobar o pedir cambios, con comentario opcional. Al aprobar,
 * si el sitio publica solo y no hay fecha programada, se envía a WordPress en el acto.
 */
export async function reviewArticle(
  deps: CoreDeps,
  organizationId: string,
  userId: string,
  id: string,
  input: ReviewInput,
): Promise<Article> {
  const article = await requireArticle(deps.prisma, organizationId, id);
  if (!article.contentHtml || article.status === 'writing' || article.status === 'publishing') {
    throw new AppError('INVALID_STATE', `Article is ${article.status}`, { httpStatus: 409 });
  }
  const approved = input.decision === 'approve';
  const scope = siteScope(deps.prisma, article.siteId);
  await scope.articles.updateById(article.id, {
    reviewStatus: approved ? 'approved' : 'changes_requested',
  });
  await deps.prisma.articleComment.create({
    data: {
      siteId: article.siteId,
      articleId: article.id,
      userId,
      kind: approved ? 'approve' : 'request_changes',
      body: input.comment ?? '',
    },
  });
  const site = await deps.prisma.site.findUniqueOrThrow({ where: { id: article.siteId } });
  if (
    approved &&
    parseSettings(site.settings).autoPublish &&
    !article.scheduledFor &&
    article.status === 'ready'
  ) {
    await scope.articles.updateById(article.id, { status: 'publishing' });
    await deps.dispatcher.enqueue('publish', { siteId: article.siteId, refId: article.id });
  }
  return requireArticle(deps.prisma, organizationId, id);
}

export async function listComments(
  deps: CoreDeps,
  organizationId: string,
  id: string,
): Promise<CommentDto[]> {
  const article = await requireArticle(deps.prisma, organizationId, id);
  const comments = await deps.prisma.articleComment.findMany({
    where: { articleId: article.id, siteId: article.siteId },
    orderBy: { createdAt: 'asc' },
    include: { user: { select: { email: true } } },
  });
  return comments.map((c) => ({
    id: c.id,
    kind: c.kind as CommentDto['kind'],
    body: c.body,
    author: c.user?.email ?? null,
    createdAt: c.createdAt.toISOString(),
  }));
}

export async function addComment(
  deps: CoreDeps,
  organizationId: string,
  userId: string,
  id: string,
  body: string,
): Promise<CommentDto[]> {
  const article = await requireArticle(deps.prisma, organizationId, id);
  await deps.prisma.articleComment.create({
    data: { siteId: article.siteId, articleId: article.id, userId, kind: 'comment', body },
  });
  return listComments(deps, organizationId, id);
}

/**
 * Calendario editorial: lo publicado y lo programado en el rango, más lo que está listo sin fecha
 * (para arrastrarlo a un día).
 */
export async function getCalendar(
  deps: CoreDeps,
  organizationId: string,
  siteId: string,
  from: Date,
  to: Date,
): Promise<{ items: ArticleSummaryDto[]; unscheduled: ArticleSummaryDto[] }> {
  const site = await requireSite(deps.prisma, organizationId, siteId);
  const scope = siteScope(deps.prisma, site.id);
  const [items, unscheduled] = await Promise.all([
    scope.articles.findMany({
      where: {
        OR: [
          { scheduledFor: { gte: from, lte: to } },
          { scheduledFor: null, publishedAt: { gte: from, lte: to } },
        ],
      },
      orderBy: { createdAt: 'asc' },
    }),
    scope.articles.findMany({
      where: { status: 'ready', scheduledFor: null, publishedAt: null },
      orderBy: { createdAt: 'asc' },
      take: 50,
    }),
  ]);
  return { items: items.map(toArticleSummary), unscheduled: unscheduled.map(toArticleSummary) };
}
