import { errorCode } from '../errors.js';
import { siteScope } from '../tenant.js';
import type { PipelineContext } from './context.js';
import { assertQuota } from './quota.js';

export type FirstArticleResult =
  | { started: true; keywordId: string }
  | { started: false; reason: 'HAS_ARTICLES' | 'NO_KEYWORDS' | string };

/**
 * Alta guiada: tras el primer discover de una tienda nueva, redacta el primer artículo con la mejor
 * keyword para que el usuario vea un resultado real en minutos. Se detiene en `ready` (borrador para
 * revisar en el panel), igual que el botón "Generar artículo". Respeta la cuota del plan.
 */
export async function startFirstArticle(
  ctx: PipelineContext,
  siteId: string,
): Promise<FirstArticleResult> {
  const scope = siteScope(ctx.prisma, siteId);
  if ((await scope.articles.count()) > 0) return { started: false, reason: 'HAS_ARTICLES' };
  const [keyword] = await scope.keywords.findMany({
    where: { status: 'pending' },
    orderBy: [{ score: 'desc' }, { createdAt: 'asc' }],
    take: 1,
  });
  if (!keyword) return { started: false, reason: 'NO_KEYWORDS' };
  try {
    await assertQuota(ctx.prisma, siteId, 'generate_article', ctx.config);
    await scope.keywords.updateById(keyword.id, { status: 'queued' });
    await ctx.dispatcher.enqueue('outline', { siteId, refId: keyword.id, chain: 'ready' });
  } catch (err) {
    await scope.keywords.updateById(keyword.id, { status: 'pending' }).catch(() => undefined);
    return { started: false, reason: errorCode(err) };
  }
  return { started: true, keywordId: keyword.id };
}
