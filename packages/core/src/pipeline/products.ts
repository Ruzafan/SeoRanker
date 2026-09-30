import type { Prisma, Product } from '@seo/db';
import {
  META_DESCRIPTION_MAX,
  SEO_TITLE_MAX,
  diagnoseProduct,
  plainText,
  type ProductSnapshot,
} from '@seo/shared';
import {
  PRODUCT_SEO_PROMPT_VERSION,
  productSeoSchema,
  productSeoSystem,
  productSeoToolDescription,
  productSeoUser,
  type ProductSeoResult,
} from '../ai/prompts/product-seo.js';
import { AppError, notFound } from '../errors.js';
import { adapterFor, loadSite, modelFor, siteContext } from './common.js';
import type { PipelineContext, RunInfo } from './context.js';
import { runTracked } from './run-tracked.js';
import { recordUsage } from './usage.js';

const MAX_PAGES = 80; // 4000 productos
const CONTEXT_KEYWORDS = 15;
const MAX_NEW_TAGS = 5;

/** Datos de un producto a partir de lo que devuelve el conector. */
export function productRow(p: ProductSnapshot, now: Date) {
  const { score, issues } = diagnoseProduct(p);
  return {
    name: p.name.slice(0, 300),
    url: p.url,
    data: p as unknown as Prisma.InputJsonValue,
    score,
    issues,
    scannedAt: now,
  };
}

export const snapshotOf = (product: Pick<Product, 'data'>) =>
  product.data as unknown as ProductSnapshot;

/** Diagnóstico de todos los productos publicados (sin Claude: no gasta cupo). */
export function runProductScan(ctx: PipelineContext, info: RunInfo): Promise<void> {
  return runTracked(ctx, info, async () => {
    const site = await loadSite(ctx, info.siteId);
    const adapter = adapterFor(ctx, site);
    const now = new Date();
    const seen: number[] = [];
    let complete = false;
    for (let page = 1; page <= MAX_PAGES; page++) {
      const res = await adapter.listProducts(page);
      if (!res) {
        throw new AppError('CONNECTOR_UPDATE_REQUIRED', 'The connector does not expose products', {
          httpStatus: 409,
        });
      }
      for (const p of res.products) {
        const row = productRow(p, now);
        await ctx.prisma.product.upsert({
          where: { siteId_remoteId: { siteId: site.id, remoteId: p.id } },
          create: { siteId: site.id, remoteId: p.id, ...row },
          update: row,
        });
        seen.push(p.id);
      }
      if (!res.hasMore) {
        complete = true;
        break;
      }
    }
    // Productos borrados o despublicados: fuera (con sus sugerencias). Solo si se leyó todo.
    const removed = complete
      ? (
          await ctx.prisma.product.deleteMany({
            where: { siteId: site.id, remoteId: { notIn: seen } },
          })
        ).count
      : 0;
    return { meta: { products: seen.length, removed, complete } };
  });
}

type NewSuggestion = Omit<Prisma.ProductSuggestionCreateManyInput, 'siteId' | 'productId'>;

const clean = (s: string) => s.replace(/\s+/g, ' ').trim();
const same = (a: string, b: string) => clean(a).toLowerCase() === clean(b).toLowerCase();
const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Convierte la propuesta de Claude en sugerencias: `fill` si el campo estaba vacío, `improve`
 * si sustituye un valor existente. Descarta lo que no respeta las reglas (longitudes, campos que
 * nunca se sustituyen, títulos con variables del plugin SEO, etiquetas repetidas).
 */
export function buildSuggestions(p: ProductSnapshot, r: ProductSeoResult): NewSuggestion[] {
  const out: NewSuggestion[] = [];
  const add = (
    field: string,
    current: string,
    value: string,
    reason: string,
    allowImprove: boolean,
  ) => {
    const v = clean(value);
    if (!v) return;
    const cur = clean(current);
    if (!cur)
      out.push({ field, kind: 'fill', before: null, after: v, reason: clean(reason) || null });
    else if (allowImprove && !same(cur, v))
      out.push({
        field,
        kind: 'improve',
        before: current,
        after: v,
        reason: clean(reason) || null,
      });
  };
  if (p.seoPlugin) {
    if (r.focusKeyword.value.length <= 80)
      add(
        'focus_keyword',
        p.focusKeyword,
        r.focusKeyword.value.toLowerCase(),
        r.focusKeyword.reason,
        false,
      );
    if (clean(r.seoTitle.value).length <= SEO_TITLE_MAX + 10)
      add('seo_title', p.seoTitle, r.seoTitle.value, r.seoTitle.reason, !p.seoTitle.includes('%'));
    const meta = clean(r.metaDescription.value).length;
    if (meta >= 50 && meta <= META_DESCRIPTION_MAX + 10)
      add(
        'meta_description',
        p.metaDescription,
        r.metaDescription.value,
        r.metaDescription.reason,
        true,
      );
  }
  if (!plainText(p.shortDescription) && clean(r.shortDescription.value)) {
    out.push({
      field: 'short_description',
      kind: 'fill',
      before: null,
      after: `<p>${escapeHtml(clean(r.shortDescription.value))}</p>`,
      reason: clean(r.shortDescription.reason) || null,
    });
  }
  const existing = new Set(p.tags.map((t) => t.toLowerCase().trim()));
  const newTags = [
    ...new Set(
      r.tagsToAdd
        .map((t) => clean(t).toLowerCase())
        .filter((t) => t && t.length <= 40 && !t.includes(',') && !existing.has(t)),
    ),
  ].slice(0, MAX_NEW_TAGS);
  if (newTags.length) {
    out.push({
      field: 'tags',
      kind: p.tags.length ? 'improve' : 'fill',
      before: p.tags.length ? JSON.stringify(p.tags) : null,
      after: JSON.stringify([...p.tags, ...newTags]),
      reason: clean(r.tagsReason) || null,
    });
  }
  const missingAlt = new Set(p.images.filter((i) => !i.alt.trim()).map((i) => i.id));
  for (const a of r.imageAlts) {
    const alt = clean(a.alt).slice(0, 150);
    if (alt && missingAlt.delete(a.imageId))
      out.push({
        field: `image_alt:${a.imageId}`,
        kind: 'fill',
        before: null,
        after: alt,
        reason: null,
      });
  }
  return out;
}

/** Claude revisa UN producto y deja sugerencias pendientes (sustituyen a las pendientes anteriores). */
export function runProductSeo(ctx: PipelineContext, info: RunInfo): Promise<void> {
  return runTracked(ctx, info, async (tracker) => {
    const site = await loadSite(ctx, info.siteId);
    const product = await ctx.prisma.product.findFirst({
      where: { id: info.refId ?? '', siteId: site.id },
    });
    if (!product) throw notFound('Product');

    // Se relee de la tienda: las sugerencias se comparan con el valor actual, no con el del escaneo.
    const res = await adapterFor(ctx, site).listProducts(1, [product.remoteId]);
    if (!res) {
      throw new AppError('CONNECTOR_UPDATE_REQUIRED', 'The connector does not expose products', {
        httpStatus: 409,
      });
    }
    const snapshot = res.products[0];
    if (!snapshot) {
      await ctx.prisma.product.delete({ where: { id: product.id } });
      throw notFound('Product');
    }
    const now = new Date();
    await ctx.prisma.product.update({ where: { id: product.id }, data: productRow(snapshot, now) });

    const keywords = await ctx.prisma.keyword.findMany({
      where: { siteId: site.id, status: { not: 'discarded' } },
      orderBy: [{ score: 'desc' }],
      take: CONTEXT_KEYWORDS,
      select: { term: true },
    });
    const result = await ctx.claude.callTool({
      model: modelFor(ctx, site),
      system: productSeoSystem(siteContext(site)),
      user: productSeoUser(
        snapshot,
        keywords.map((k) => k.term),
      ),
      maxTokens: 2000,
      toolDescription: productSeoToolDescription,
      schema: productSeoSchema,
    });
    await tracker.add(result.model, result.usage);

    const suggestions = buildSuggestions(snapshot, result.data);
    await ctx.prisma.$transaction([
      ctx.prisma.productSuggestion.deleteMany({
        where: { productId: product.id, status: 'pending' },
      }),
      ctx.prisma.productSuggestion.createMany({
        data: suggestions.map((s) => ({ ...s, siteId: site.id, productId: product.id })),
      }),
      ctx.prisma.product.update({ where: { id: product.id }, data: { analyzedAt: now } }),
    ]);
    await recordUsage(ctx.prisma, site.id, { products: 1 });
    return {
      meta: { suggestions: suggestions.length, prompt: PRODUCT_SEO_PROMPT_VERSION },
    };
  });
}
