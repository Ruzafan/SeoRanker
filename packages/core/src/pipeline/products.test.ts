import { randomBytes } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetDatabase, setupTestDatabase } from '@seo/db/testing';
import type { PrismaClient } from '@seo/db';
import { DEFAULT_SETTINGS, type ProductSnapshot } from '@seo/shared';
import type { ClaudeClient } from '../ai/claude.js';
import type { ProductSeoResult } from '../ai/prompts/product-seo.js';
import { encryptJson } from '../crypto.js';
import type { EnqueueInput, JobDispatcher, PipelineJobType } from '../queue.js';
import type { CoreDeps } from '../services/deps.js';
import {
  analyzeProduct,
  analyzeProducts,
  decideSuggestions,
  getProduct,
  getProductsOverview,
  listProducts,
  revertSuggestion,
} from '../services/products.js';
import type { PipelineContext } from './context.js';
import { runPipelineJob } from './index.js';
import { buildSuggestions } from './products.js';

const product = (over: Partial<ProductSnapshot> = {}): ProductSnapshot => ({
  id: 10,
  name: 'Taza Hogwarts',
  url: 'https://tienda.es/taza',
  status: 'publish',
  shortDescription: '',
  description: 'Taza de cerámica de 350 ml con el escudo de Hogwarts. '.repeat(10),
  categories: ['Tazas'],
  tags: ['harry potter'],
  price: '12.95',
  images: [
    { id: 5, url: 'https://tienda.es/a.jpg', alt: '' },
    { id: 6, url: 'https://tienda.es/b.jpg', alt: 'Taza de lado' },
  ],
  seoPlugin: 'yoast',
  focusKeyword: '',
  seoTitle: '',
  metaDescription: 'Taza.',
  ...over,
});

const proposal = (over: Partial<ProductSeoResult> = {}): ProductSeoResult => ({
  focusKeyword: { value: 'Taza Hogwarts', reason: 'Búsqueda principal' },
  seoTitle: { value: 'Taza Hogwarts de cerámica 350 ml', reason: 'Incluye la keyword' },
  metaDescription: {
    value:
      'Taza de cerámica de 350 ml con el escudo de Hogwarts. Perfecta para fans de Harry Potter: pídela hoy.',
    reason: 'La actual es demasiado corta',
  },
  shortDescription: {
    value: 'Taza de cerámica de 350 ml con el escudo de Hogwarts.',
    reason: 'Vacía',
  },
  tagsToAdd: ['Tazas Harry Potter', 'harry potter', 'regalos, frikis'],
  tagsReason: 'Categorías por las que se navega',
  imageAlts: [
    { imageId: 5, alt: 'Taza Hogwarts de frente' },
    { imageId: 6, alt: 'No debe cambiar: ya tenía alt' },
  ],
  ...over,
});

describe('buildSuggestions', () => {
  it('rellena huecos, mejora lo mejorable y respeta lo que no se sustituye', () => {
    const s = buildSuggestions(product(), proposal());
    expect(s.map((x) => [x.field, x.kind])).toEqual([
      ['focus_keyword', 'fill'],
      ['seo_title', 'fill'],
      ['meta_description', 'improve'],
      ['short_description', 'fill'],
      ['tags', 'improve'],
      ['image_alt:5', 'fill'],
    ]);
    expect(s.find((x) => x.field === 'focus_keyword')?.after).toBe('taza hogwarts');
    expect(s.find((x) => x.field === 'meta_description')?.before).toBe('Taza.');
    expect(s.find((x) => x.field === 'short_description')?.after).toBe(
      '<p>Taza de cerámica de 350 ml con el escudo de Hogwarts.</p>',
    );
    // Solo la etiqueta nueva y sin comas; la existente se conserva.
    expect(JSON.parse(s.find((x) => x.field === 'tags')?.after ?? '[]')).toEqual([
      'harry potter',
      'tazas harry potter',
    ]);
  });

  it('nunca sustituye keyword ni descripción corta existentes, ni títulos con variables', () => {
    const s = buildSuggestions(
      product({
        focusKeyword: 'taza',
        shortDescription: '<p>Ya tiene</p>',
        seoTitle: '%%title%% %%sep%% %%sitename%%',
        metaDescription:
          'Taza de cerámica de 350 ml con el escudo de Hogwarts. Perfecta para fans de Harry Potter: pídela hoy.',
      }),
      proposal({ tagsToAdd: [], imageAlts: [] }),
    );
    expect(s).toEqual([]);
  });

  it('sin plugin SEO no propone keyword, título ni meta', () => {
    const s = buildSuggestions(
      product({ seoPlugin: null }),
      proposal({ tagsToAdd: [], imageAlts: [] }),
    );
    expect(s.map((x) => x.field)).toEqual(['short_description']);
  });
});

const db = await setupTestDatabase('core_products');
const log = { info: () => undefined, warn: () => undefined, error: () => undefined };

class FakeDispatcher implements JobDispatcher {
  queue: { type: PipelineJobType; jobRunId: string; input: EnqueueInput }[] = [];
  constructor(private readonly prisma: PrismaClient) {}
  async enqueue(type: PipelineJobType, input: EnqueueInput) {
    const run = await this.prisma.jobRun.create({
      data: { siteId: input.siteId, type, status: 'queued', refId: input.refId ?? null },
    });
    this.queue.push({ type, jobRunId: run.id, input });
    return { jobRunId: run.id };
  }
}

/** WordPress + conector 1.3.0 simulados por HTTP, con la comprobación de `expected` del plugin. */
function fakeWordPress(store: Map<number, ProductSnapshot>) {
  const posts: { id: number; changes: unknown }[] = [];
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const get = (p: ProductSnapshot, field: string): string | string[] | null => {
    if (field === 'focus_keyword') return p.focusKeyword;
    if (field === 'seo_title') return p.seoTitle;
    if (field === 'meta_description') return p.metaDescription;
    if (field === 'short_description') return p.shortDescription;
    if (field === 'tags') return p.tags;
    const m = /^image_alt:(\d+)$/.exec(field);
    return m ? (p.images.find((i) => i.id === Number(m[1]))?.alt ?? null) : null;
  };
  const norm = (v: unknown) =>
    Array.isArray(v)
      ? JSON.stringify([...v].map((x) => String(x).toLowerCase()).sort())
      : String(v ?? '').trim();
  const fetchFn = (async (u: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(u));
    if (url.pathname === '/wp-json/') return json({ namespaces: ['wp/v2', 'seo-autopilot/v1'] });
    if (url.pathname === '/wp-json/seo-autopilot/v1/status')
      return json({ version: '1.3.0', seoPlugin: 'yoast', woocommerce: true });
    if (url.pathname === '/wp-json/seo-autopilot/v1/products') {
      const ids = (url.searchParams.get('ids') ?? '').split(',').filter(Boolean).map(Number);
      const all = [...store.values()].filter((p) => !ids.length || ids.includes(p.id));
      return json({ products: all, hasMore: false });
    }
    const m = /^\/wp-json\/seo-autopilot\/v1\/products\/(\d+)$/.exec(url.pathname);
    if (m && init?.method === 'POST') {
      const p = store.get(Number(m[1]));
      if (!p) return json({ code: 'seo_autopilot_not_found' }, 404);
      const { changes } = JSON.parse(String(init.body)) as {
        changes: { field: string; value: string | string[]; expected: string | string[] }[];
      };
      posts.push({ id: p.id, changes });
      for (const c of changes)
        if (norm(get(p, c.field)) !== norm(c.expected))
          return json({ code: 'seo_autopilot_changed', message: 'changed' }, 409);
      const next = { ...p, images: p.images.map((i) => ({ ...i })) };
      for (const c of changes) {
        if (c.field === 'focus_keyword') next.focusKeyword = c.value as string;
        else if (c.field === 'seo_title') next.seoTitle = c.value as string;
        else if (c.field === 'meta_description') next.metaDescription = c.value as string;
        else if (c.field === 'short_description') next.shortDescription = c.value as string;
        else if (c.field === 'tags') next.tags = c.value as string[];
        else {
          const img = next.images.find((i) => `image_alt:${i.id}` === c.field);
          if (img) img.alt = c.value as string;
        }
      }
      store.set(p.id, next);
      return json(next);
    }
    return json({}, 404);
  }) as typeof fetch;
  return { fetchFn, posts };
}

describe.skipIf(!db)('SEO de productos (integración con Postgres)', () => {
  const prisma = db?.prisma as PrismaClient;
  const key = randomBytes(32);
  let dispatcher: FakeDispatcher;
  let store: Map<number, ProductSnapshot>;
  let wp: ReturnType<typeof fakeWordPress>;
  let orgId: string;
  let siteId: string;
  const claude = {
    callTool: vi.fn(async () => ({
      data: proposal(),
      usage: { inputTokens: 1000, outputTokens: 300 },
      model: 'claude-sonnet-5',
    })),
  } as unknown as ClaudeClient;

  const ctx = (): PipelineContext => ({
    prisma,
    claude,
    dispatcher,
    encryptionKey: key,
    config: { defaultModel: 'claude-sonnet-5', freePlanMaxArticles: 3, allowPrivateHosts: true },
    log,
    fetchFn: wp.fetchFn,
  });
  const deps = (): CoreDeps => ({
    prisma,
    dispatcher,
    encryptionKey: key,
    config: { allowPrivateHosts: true, freePlanMaxArticles: 3 },
    fetchFn: wp.fetchFn,
  });
  async function drain() {
    while (dispatcher.queue.length) {
      const job = dispatcher.queue.shift()!;
      await runPipelineJob(ctx(), job.type, {
        jobRunId: job.jobRunId,
        siteId: job.input.siteId,
        refId: job.input.refId,
        attempt: 1,
        maxAttempts: 1,
      });
    }
  }

  beforeEach(async () => {
    await resetDatabase(prisma);
    dispatcher = new FakeDispatcher(prisma);
    store = new Map([
      [10, product()],
      [11, product({ id: 11, name: 'Bufanda Gryffindor', metaDescription: '', tags: [] })],
    ]);
    wp = fakeWordPress(store);
    const org = await prisma.organization.create({ data: { name: 'Org', plan: 'pro' } });
    orgId = org.id;
    const site = await prisma.site.create({
      data: {
        organizationId: orgId,
        name: 'Tienda',
        url: 'https://tienda.es',
        credentials: encryptJson(key, { username: 'u', appPassword: 'p' }),
        settings: { ...DEFAULT_SETTINGS, connectorVersion: '1.3.0', woocommerce: true },
      },
    });
    siteId = site.id;
  });
  afterAll(async () => prisma.$disconnect());

  async function scanned() {
    await dispatcher.enqueue('product-scan', { siteId });
    await drain();
    const items = (
      await listProducts(deps(), orgId, siteId, {
        sort: 'score',
        order: 'asc',
        page: 1,
        pageSize: 25,
      })
    ).items;
    return items;
  }

  it('escanea, sugiere, aplica solo lo aceptado y lo deshace', async () => {
    const items = await scanned();
    expect(items.map((p) => p.name)).toEqual(['Bufanda Gryffindor', 'Taza Hogwarts']);
    const overview = await getProductsOverview(deps(), orgId, siteId);
    expect(overview).toMatchObject({ total: 2, supported: true, quota: { used: 0, limit: 100 } });
    expect(overview.issues.find((i) => i.issue === 'NO_META_DESCRIPTION')?.count).toBe(1);

    const taza = items.find((p) => p.name === 'Taza Hogwarts')!;
    await analyzeProduct(deps(), orgId, taza.id);
    await drain();
    let dto = await getProduct(deps(), orgId, taza.id);
    expect(dto.pendingSuggestions).toBe(6);
    expect((await getProductsOverview(deps(), orgId, siteId)).quota.used).toBe(1);
    // Nada se ha escrito todavía en la tienda.
    expect(wp.posts).toEqual([]);

    const byField = (f: string) => dto.suggestions.find((s) => s.field === f)!;
    dto = await decideSuggestions(deps(), orgId, taza.id, {
      ids: [byField('meta_description').id, byField('tags').id],
      decision: 'accept',
    });
    expect(store.get(10)?.metaDescription).toMatch(/^Taza de cerámica de 350 ml/);
    expect(store.get(10)?.tags).toEqual(['harry potter', 'tazas harry potter']);
    expect(store.get(10)?.focusKeyword).toBe(''); // no aceptado: intacto
    expect(wp.posts[0]?.changes).toEqual([
      { field: 'meta_description', value: expect.any(String), expected: 'Taza.' },
      { field: 'tags', value: ['harry potter', 'tazas harry potter'], expected: ['harry potter'] },
    ]);
    dto = await decideSuggestions(deps(), orgId, taza.id, {
      ids: [byField('focus_keyword').id],
      decision: 'reject',
    });
    expect(dto.suggestions.filter((s) => s.status === 'pending')).toHaveLength(3);
    expect(store.get(10)?.focusKeyword).toBe('');

    // Deshacer devuelve el valor anterior.
    dto = await revertSuggestion(deps(), orgId, byField('meta_description').id);
    expect(store.get(10)?.metaDescription).toBe('Taza.');
    expect(dto.suggestions.find((s) => s.field === 'meta_description')?.status).toBe('reverted');
  });

  it('no pisa un valor editado en WordPress después de la sugerencia', async () => {
    const [, taza] = await scanned();
    await analyzeProduct(deps(), orgId, taza!.id);
    await drain();
    const dto = await getProduct(deps(), orgId, taza!.id);
    store.set(10, { ...store.get(10)!, metaDescription: 'Editada a mano en WordPress' });
    const meta = dto.suggestions.find((s) => s.field === 'meta_description')!;
    await expect(
      decideSuggestions(deps(), orgId, taza!.id, { ids: [meta.id], decision: 'accept' }),
    ).rejects.toMatchObject({ code: 'PRODUCT_CHANGED' });
    expect(store.get(10)?.metaDescription).toBe('Editada a mano en WordPress');
    expect((await getProduct(deps(), orgId, taza!.id)).pendingSuggestions).toBe(6);
  });

  it('cupo por plan: free revisa 1 producto al mes y sin lotes; pro por lotes', async () => {
    const [bufanda, taza] = await scanned();
    const batch = await analyzeProducts(deps(), orgId, siteId, { limit: 10 });
    expect(batch.enqueued).toBe(2);
    await drain();

    await prisma.organization.update({ where: { id: orgId }, data: { plan: 'free' } });
    await expect(analyzeProducts(deps(), orgId, siteId, { limit: 10 })).rejects.toMatchObject({
      code: 'PLAN_FEATURE_REQUIRED',
    });
    await prisma.usageRecord.updateMany({ data: { products: 0 } });
    await analyzeProduct(deps(), orgId, bufanda!.id);
    await expect(analyzeProduct(deps(), orgId, taza!.id)).rejects.toMatchObject({
      code: 'PRODUCT_QUOTA_EXCEEDED',
    });
  });
});
