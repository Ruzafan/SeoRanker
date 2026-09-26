import type { Keyword, Prisma } from '@seo/db';
import type {
  BatchKeywordsInput,
  BatchResultDto,
  ClusterDto,
  CreateKeywordsInput,
  EnqueuedDto,
  KeywordQuery,
  Paginated,
  PatchKeywordInput,
} from '@seo/shared';
import { AppError } from '../errors.js';
import { normalizeTerm } from '../keywords/provider.js';
import { assertQuota } from '../pipeline/quota.js';
import { requireKeyword, requireSite, siteScope } from '../tenant.js';
import type { CoreDeps } from './deps.js';

export async function listKeywords(
  deps: CoreDeps,
  organizationId: string,
  siteId: string,
  q: KeywordQuery,
): Promise<Paginated<Keyword>> {
  await requireSite(deps.prisma, organizationId, siteId);
  const scope = siteScope(deps.prisma, siteId);
  const where: Prisma.KeywordWhereInput = {
    ...(q.status ? { status: q.status } : {}),
    ...(q.source ? { source: q.source } : {}),
    ...(q.clusterId ? { clusterId: q.clusterId } : {}),
    ...(q.search ? { term: { contains: q.search, mode: 'insensitive' } } : {}),
  };
  const [items, total] = await Promise.all([
    scope.keywords.findMany({
      where,
      // Volumen e impresiones pueden faltar: los vacíos van siempre al final.
      orderBy: [
        q.sort === 'volume' || q.sort === 'gscImpressions'
          ? { [q.sort]: { sort: q.order, nulls: 'last' } }
          : { [q.sort]: q.order },
        { id: 'asc' },
      ],
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
    scope.keywords.count(where),
  ]);
  return { items, page: q.page, pageSize: q.pageSize, total };
}

export async function createKeywords(
  deps: CoreDeps,
  organizationId: string,
  siteId: string,
  input: CreateKeywordsInput,
): Promise<{ created: number; skipped: number }> {
  await requireSite(deps.prisma, organizationId, siteId);
  const terms = [...new Set(input.terms.map(normalizeTerm).filter((t) => t.length >= 2))];
  const res = await siteScope(deps.prisma, siteId).keywords.createMany(
    terms.map((term) => ({ term, source: 'manual', status: 'pending' })),
  );
  return { created: res.count, skipped: terms.length - res.count };
}

export async function patchKeyword(
  deps: CoreDeps,
  organizationId: string,
  id: string,
  input: PatchKeywordInput,
): Promise<Keyword> {
  const kw = await requireKeyword(deps.prisma, organizationId, id);
  if (input.status === 'pending' && (kw.status === 'queued' || kw.status === 'processing')) {
    throw new AppError('INVALID_STATE', 'Keyword is being processed', { httpStatus: 409 });
  }
  const scope = siteScope(deps.prisma, kw.siteId);
  // Recuperar una keyword descartada por similitud es una decisión del usuario: se respeta.
  const override =
    input.status === 'pending' && kw.discardReason
      ? { discardReason: null, similarToArticleId: null, allowSimilar: true }
      : {};
  await scope.keywords.updateById(kw.id, { ...input, ...override });
  const updated = await scope.keywords.findById(kw.id);
  if (!updated) throw new AppError('INTERNAL_ERROR', 'Keyword vanished');
  return updated;
}

export async function deleteKeyword(
  deps: CoreDeps,
  organizationId: string,
  id: string,
): Promise<void> {
  const kw = await requireKeyword(deps.prisma, organizationId, id);
  await siteScope(deps.prisma, kw.siteId).keywords.deleteById(kw.id);
}

const QUEUEABLE = new Set(['pending', 'failed', 'done']);

/** Marca la keyword como `queued` y encola outline; revierte el estado si no se pudo encolar. */
async function queueKeyword(deps: CoreDeps, kw: Keyword): Promise<EnqueuedDto> {
  if (!QUEUEABLE.has(kw.status)) {
    throw new AppError('INVALID_STATE', `Keyword is ${kw.status}`, { httpStatus: 409 });
  }
  await assertQuota(deps.prisma, kw.siteId, 'generate_article', deps.config);
  const scope = siteScope(deps.prisma, kw.siteId);
  await scope.keywords.updateById(kw.id, { status: 'queued' });
  try {
    return await deps.dispatcher.enqueue('outline', {
      siteId: kw.siteId,
      refId: kw.id,
      chain: 'ready',
    });
  } catch (err) {
    await scope.keywords.updateById(kw.id, { status: kw.status });
    throw err;
  }
}

export async function generateFromKeyword(
  deps: CoreDeps,
  organizationId: string,
  id: string,
): Promise<EnqueuedDto> {
  return queueKeyword(deps, await requireKeyword(deps.prisma, organizationId, id));
}

export async function batchKeywords(
  deps: CoreDeps,
  organizationId: string,
  siteId: string,
  input: BatchKeywordsInput,
): Promise<BatchResultDto> {
  await requireSite(deps.prisma, organizationId, siteId);
  const scope = siteScope(deps.prisma, siteId);
  const rows = await scope.keywords.findMany({ where: { id: { in: input.ids } } });

  if (input.action === 'discard') {
    const ids = rows
      .filter((k) => k.status !== 'queued' && k.status !== 'processing')
      .map((k) => k.id);
    const res = await deps.prisma.keyword.updateMany({
      where: { id: { in: ids }, siteId },
      data: { status: 'discarded' },
    });
    return { processed: res.count, skipped: input.ids.length - res.count };
  }

  let processed = 0;
  for (const kw of rows) {
    if (!QUEUEABLE.has(kw.status)) continue;
    await queueKeyword(deps, kw); // QUOTA_EXCEEDED corta el lote; lo ya encolado se mantiene
    processed++;
  }
  return { processed, skipped: input.ids.length - processed };
}

/** Clusters temáticos del sitio con su pilar y su avance. */
export async function listClusters(
  deps: CoreDeps,
  organizationId: string,
  siteId: string,
): Promise<ClusterDto[]> {
  const site = await requireSite(deps.prisma, organizationId, siteId);
  const clusters = await deps.prisma.keywordCluster.findMany({
    where: { siteId: site.id },
    orderBy: { name: 'asc' },
    include: { keywords: { select: { id: true, term: true, status: true } } },
  });
  return clusters.map((c) => {
    const pillar = c.keywords.find((k) => k.id === c.pillarKeywordId);
    return {
      id: c.id,
      name: c.name,
      pillar: pillar ? { keywordId: pillar.id, term: pillar.term, status: pillar.status } : null,
      keywords: c.keywords.length,
      done: c.keywords.filter((k) => k.status === 'done').length,
    };
  });
}

/** Reagrupa las keywords del sitio en clusters (trabajo `cluster`). */
export async function rebuildClusters(
  deps: CoreDeps,
  organizationId: string,
  siteId: string,
): Promise<EnqueuedDto> {
  const site = await requireSite(deps.prisma, organizationId, siteId);
  return deps.dispatcher.enqueue('cluster', { siteId: site.id });
}
