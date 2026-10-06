import type { Prisma, Product, ProductSuggestion } from '@seo/db';
import {
  CONNECTOR_VERSION_PRODUCTS,
  isOlderVersion,
  parseSettings,
  planFor,
  type AnalyzeProductsInput,
  type DecideSuggestionsInput,
  type EnqueuedDto,
  type Paginated,
  type ProductDto,
  type ProductField,
  type ProductIssue,
  type ProductQuery,
  type ProductSuggestionDto,
  type ProductSummaryDto,
  type ProductsOverviewDto,
} from '@seo/shared';
import { createAdapter, readCredentials } from '../adapters/factory.js';
import { assertCapability } from '../platform.js';
import type { ProductChange } from '../adapters/index.js';
import { AppError, notFound } from '../errors.js';
import { productRow, snapshotOf } from '../pipeline/products.js';
import { currentPeriod } from '../pipeline/usage.js';
import { requireProduct, requireSite } from '../tenant.js';
import type { CoreDeps } from './deps.js';

const ACTIVE = ['queued', 'running'];

// ---- Cupo ------------------------------------------------------------------

/** Productos revisados este mes por toda la organización, incluidos los que están en marcha. */
async function productQuota(deps: CoreDeps, organizationId: string) {
  const org = await deps.prisma.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { plan: true },
  });
  const plan = planFor(org.plan);
  const [usage, inFlight] = await Promise.all([
    deps.prisma.usageRecord.aggregate({
      where: { period: currentPeriod(), site: { organizationId } },
      _sum: { products: true },
    }),
    deps.prisma.jobRun.count({
      where: { type: 'product-seo', status: { in: ACTIVE }, site: { organizationId } },
    }),
  ]);
  const used = (usage._sum.products ?? 0) + inFlight;
  return { used, limit: plan.productsPerMonth, batch: plan.productBatch };
}

// ---- Lectura -----------------------------------------------------------------

async function analyzingIds(deps: CoreDeps, siteId: string): Promise<Set<string>> {
  const runs = await deps.prisma.jobRun.findMany({
    where: { siteId, type: 'product-seo', status: { in: ACTIVE }, refId: { not: null } },
    select: { refId: true },
  });
  return new Set(runs.map((r) => r.refId as string));
}

function toSummary(p: Product, pending: number, analyzing: boolean): ProductSummaryDto {
  const snap = snapshotOf(p);
  return {
    id: p.id,
    remoteId: p.remoteId,
    name: p.name,
    url: p.url,
    image: snap.images[0]?.url || null,
    score: p.score,
    issues: p.issues as ProductIssue[],
    pendingSuggestions: pending,
    analyzedAt: p.analyzedAt?.toISOString() ?? null,
    analyzing,
  };
}

const toSuggestionDto = (s: ProductSuggestion): ProductSuggestionDto => ({
  id: s.id,
  field: s.field as ProductField,
  kind: s.kind === 'improve' ? 'improve' : 'fill',
  before: s.before,
  after: s.after,
  reason: s.reason,
  status: s.status as ProductSuggestionDto['status'],
  createdAt: s.createdAt.toISOString(),
  decidedAt: s.decidedAt?.toISOString() ?? null,
});

export async function listProducts(
  deps: CoreDeps,
  organizationId: string,
  siteId: string,
  q: ProductQuery,
): Promise<Paginated<ProductSummaryDto>> {
  const site = await requireSite(deps.prisma, organizationId, siteId);
  const where: Prisma.ProductWhereInput = {
    siteId: site.id,
    ...(q.issue ? { issues: { has: q.issue } } : {}),
    ...(q.search ? { name: { contains: q.search, mode: 'insensitive' } } : {}),
    ...(q.pending ? { suggestions: { some: { status: 'pending' } } } : {}),
  };
  const [items, total, analyzing] = await Promise.all([
    deps.prisma.product.findMany({
      where,
      orderBy: [{ [q.sort]: q.order }, { id: 'asc' }],
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      include: { _count: { select: { suggestions: { where: { status: 'pending' } } } } },
    }),
    deps.prisma.product.count({ where }),
    analyzingIds(deps, site.id),
  ]);
  return {
    items: items.map((p) => toSummary(p, p._count.suggestions, analyzing.has(p.id))),
    page: q.page,
    pageSize: q.pageSize,
    total,
  };
}

export async function getProductsOverview(
  deps: CoreDeps,
  organizationId: string,
  siteId: string,
): Promise<ProductsOverviewDto> {
  const site = await requireSite(deps.prisma, organizationId, siteId);
  const settings = parseSettings(site.settings);
  const [agg, scanning, issueRows, quota] = await Promise.all([
    deps.prisma.product.aggregate({
      where: { siteId: site.id },
      _count: { _all: true },
      _avg: { score: true },
      _max: { scannedAt: true },
    }),
    deps.prisma.jobRun.count({
      where: { siteId: site.id, type: 'product-scan', status: { in: ACTIVE } },
    }),
    deps.prisma.$queryRaw<{ issue: string; count: bigint }[]>`
      SELECT unnest("issues") AS issue, COUNT(*) AS count FROM "Product"
      WHERE "siteId" = ${site.id} GROUP BY 1 ORDER BY 2 DESC`,
    productQuota(deps, organizationId),
  ]);
  return {
    scannedAt: agg._max.scannedAt?.toISOString() ?? null,
    scanning: scanning > 0,
    total: agg._count._all,
    averageScore: agg._avg.score === null ? null : Math.round(agg._avg.score),
    issues: issueRows.map((r) => ({ issue: r.issue as ProductIssue, count: Number(r.count) })),
    // Si ya hay productos, el conector los expone aunque los ajustes no tengan aún su versión.
    supported:
      agg._count._all > 0 ||
      (settings.woocommerce !== false &&
        settings.connectorVersion !== null &&
        !isOlderVersion(settings.connectorVersion, CONNECTOR_VERSION_PRODUCTS)),
    quota,
  };
}

export async function getProduct(
  deps: CoreDeps,
  organizationId: string,
  productId: string,
): Promise<ProductDto> {
  const product = await requireProduct(deps.prisma, organizationId, productId);
  const [suggestions, analyzing] = await Promise.all([
    deps.prisma.productSuggestion.findMany({
      where: { productId: product.id, siteId: product.siteId },
      orderBy: [{ createdAt: 'desc' }, { field: 'asc' }],
      take: 100,
    }),
    analyzingIds(deps, product.siteId),
  ]);
  const pending = suggestions.filter((s) => s.status === 'pending').length;
  return {
    ...toSummary(product, pending, analyzing.has(product.id)),
    snapshot: snapshotOf(product),
    suggestions: suggestions.map(toSuggestionDto),
  };
}

// ---- Acciones ----------------------------------------------------------------

function assertConnected(deps: CoreDeps, site: { credentials: string; platform: string }) {
  assertCapability(site, 'products');
  if (!readCredentials(site.credentials, deps.encryptionKey)) {
    throw new AppError('NO_CREDENTIALS', 'Site has no credentials', { httpStatus: 400 });
  }
}

/** Diagnóstico de toda la tienda (no gasta cupo: no usa Claude). */
export async function scanProducts(
  deps: CoreDeps,
  organizationId: string,
  siteId: string,
): Promise<EnqueuedDto> {
  const site = await requireSite(deps.prisma, organizationId, siteId);
  assertConnected(deps, site);
  return deps.dispatcher.enqueue('product-scan', { siteId: site.id });
}

function quotaExceeded(limit: number): AppError {
  return new AppError('PRODUCT_QUOTA_EXCEEDED', `Monthly product limit reached (${limit})`, {
    httpStatus: 402,
  });
}

/** Claude revisa un producto (gasta 1 del cupo mensual). */
export async function analyzeProduct(
  deps: CoreDeps,
  organizationId: string,
  productId: string,
): Promise<EnqueuedDto> {
  const product = await requireProduct(deps.prisma, organizationId, productId);
  const site = await requireSite(deps.prisma, organizationId, product.siteId);
  assertConnected(deps, site);
  if ((await analyzingIds(deps, site.id)).has(product.id)) {
    throw new AppError('INVALID_STATE', 'Product is already being analyzed', { httpStatus: 409 });
  }
  const quota = await productQuota(deps, organizationId);
  if (quota.used >= quota.limit) throw quotaExceeded(quota.limit);
  return deps.dispatcher.enqueue('product-seo', { siteId: site.id, refId: product.id });
}

/** Revisión por lotes (planes con productBatch): los indicados o los de peor puntuación. */
export async function analyzeProducts(
  deps: CoreDeps,
  organizationId: string,
  siteId: string,
  input: AnalyzeProductsInput,
): Promise<{ enqueued: number }> {
  const site = await requireSite(deps.prisma, organizationId, siteId);
  assertConnected(deps, site);
  const quota = await productQuota(deps, organizationId);
  if (!quota.batch) {
    throw new AppError('PLAN_FEATURE_REQUIRED', 'Batch product review requires a higher plan', {
      httpStatus: 402,
    });
  }
  const remaining = quota.limit - quota.used;
  if (remaining <= 0) throw quotaExceeded(quota.limit);
  const busy = await analyzingIds(deps, site.id);
  const candidates = await deps.prisma.product.findMany({
    where: {
      siteId: site.id,
      ...(input.productIds
        ? { id: { in: input.productIds } }
        : { score: { lt: 100 }, suggestions: { none: { status: 'pending' } } }),
    },
    orderBy: [{ score: 'asc' }, { id: 'asc' }],
    take: Math.min(input.productIds?.length ?? input.limit, remaining) + busy.size,
    select: { id: true },
  });
  const ids = candidates
    .map((c) => c.id)
    .filter((id) => !busy.has(id))
    .slice(0, remaining);
  for (const id of ids)
    await deps.dispatcher.enqueue('product-seo', { siteId: site.id, refId: id });
  return { enqueued: ids.length };
}

/** Valor para el conector: las etiquetas viajan como lista; los vacíos, como '' o []. */
function wire(field: string, value: string | null): string | string[] {
  if (field === 'tags') return value ? (JSON.parse(value) as string[]) : [];
  return value ?? '';
}

async function applyChanges(
  deps: CoreDeps,
  product: Product,
  changes: ProductChange[],
): Promise<void> {
  const site = await deps.prisma.site.findUniqueOrThrow({ where: { id: product.siteId } });
  const snapshot = await createAdapter(site, {
    encryptionKey: deps.encryptionKey,
    allowPrivateHosts: deps.config.allowPrivateHosts,
    fetchFn: deps.fetchFn,
  }).updateProduct(product.remoteId, changes);
  await deps.prisma.product.update({
    where: { id: product.id },
    data: productRow(snapshot, new Date()),
  });
}

/**
 * Aceptar escribe en la tienda los cambios elegidos de un producto (todo o nada) y rechazar solo
 * los descarta. Si alguno cambió en WordPress desde la sugerencia: PRODUCT_CHANGED y no se toca nada.
 */
export async function decideSuggestions(
  deps: CoreDeps,
  organizationId: string,
  productId: string,
  input: DecideSuggestionsInput,
): Promise<ProductDto> {
  const product = await requireProduct(deps.prisma, organizationId, productId);
  const suggestions = await deps.prisma.productSuggestion.findMany({
    where: { id: { in: input.ids }, productId: product.id, siteId: product.siteId },
  });
  if (suggestions.length !== new Set(input.ids).size) throw notFound('ProductSuggestion');
  if (suggestions.some((s) => s.status !== 'pending')) {
    throw new AppError('INVALID_STATE', 'Suggestion already decided', { httpStatus: 409 });
  }
  if (input.decision === 'accept') {
    await applyChanges(
      deps,
      product,
      suggestions.map((s) => ({
        field: s.field,
        value: wire(s.field, s.after),
        expected: wire(s.field, s.before),
      })),
    );
  }
  await deps.prisma.productSuggestion.updateMany({
    where: { id: { in: suggestions.map((s) => s.id) } },
    data: { status: input.decision === 'accept' ? 'applied' : 'rejected', decidedAt: new Date() },
  });
  return getProduct(deps, organizationId, product.id);
}

/** Deshace un cambio aplicado: vuelve a dejar el valor anterior (si nadie lo ha tocado desde entonces). */
export async function revertSuggestion(
  deps: CoreDeps,
  organizationId: string,
  suggestionId: string,
): Promise<ProductDto> {
  const s = await deps.prisma.productSuggestion.findFirst({
    where: { id: suggestionId, site: { organizationId } },
    include: { product: true },
  });
  if (!s) throw notFound('ProductSuggestion');
  if (s.status !== 'applied') {
    throw new AppError('INVALID_STATE', 'Only applied suggestions can be reverted', {
      httpStatus: 409,
    });
  }
  await applyChanges(deps, s.product, [
    { field: s.field, value: wire(s.field, s.before), expected: wire(s.field, s.after) },
  ]);
  await deps.prisma.productSuggestion.update({
    where: { id: s.id },
    data: { status: 'reverted', decidedAt: new Date() },
  });
  return getProduct(deps, organizationId, s.productId);
}
