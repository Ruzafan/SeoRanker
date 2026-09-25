import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetDatabase, setupTestDatabase } from '@seo/db/testing';
import type { PrismaClient } from '@seo/db';
import { DEFAULT_SETTINGS } from '@seo/shared';
import type { PublishingAdapter } from '../adapters/index.js';
import type { ClaudeClient } from '../ai/claude.js';
import { AppError } from '../errors.js';
import type { EnqueueInput, JobDispatcher, PipelineJobType } from '../queue.js';
import { requireSite, siteScope } from '../tenant.js';
import type { PipelineContext } from './context.js';
import { runPipelineJob } from './index.js';
import { startFirstArticle } from './onboarding.js';
import { assertQuota } from './quota.js';
import { runScheduler } from './scheduler.js';
import { runWatchdog } from './watchdog.js';

const db = await setupTestDatabase('core');
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

const GOOD_HTML =
  '<h2>Intro</h2><p>' +
  'palabra '.repeat(300) +
  '<a href="https://tienda.es/ok">ok</a> <a href="https://inventado.com/x">mal</a></p>';

function fakeClaude(overrides: Partial<Record<string, () => unknown>> = {}): ClaudeClient {
  const responders: Record<string, () => unknown> = {
    'Submit the article outline.': () => ({
      title: 'Cómo coleccionar figuras',
      slug: 'como-coleccionar-figuras',
      metaDescription:
        'Guía completa para empezar a coleccionar figuras de acción sin errores ni gastos inútiles.',
      sections: [
        { heading: 'Empezar', points: ['a'] },
        { heading: 'Cuidado', points: ['b'] },
        { heading: 'Comprar', points: ['c'] },
      ],
      faq: [{ question: '¿Cuánto cuesta?', answer: 'Depende de la figura elegida.' }],
    }),
    'Submit the finished article body as HTML.': () => ({ contentHtml: GOOD_HTML }),
    'Submit the brand voice profile derived from the sample content.': () => ({
      profile: 'x'.repeat(250),
    }),
    'Submit the evaluation of every candidate keyword.': () => ({ keywords: [] }),
    ...overrides,
  };
  return {
    callTool: vi.fn(async (input: { toolDescription: string }) => {
      const data = responders[input.toolDescription]?.();
      return { data, usage: { inputTokens: 1000, outputTokens: 500 }, model: 'claude-sonnet-5' };
    }),
  } as unknown as ClaudeClient;
}

function fakeAdapter(): PublishingAdapter & { created: unknown[] } {
  const created: unknown[] = [];
  return {
    created,
    testConnection: async () => ({ ok: true, message: 'OK' }),
    listContent: async () => [
      { id: 1, title: 'Página OK', url: 'https://tienda.es/ok', type: 'page' },
    ],
    getSamples: async () => [{ title: 't', body: 'b'.repeat(200), type: 'post' }],
    listCategories: async () => ['Figuras de resina'],
    createPost: async (input) => {
      created.push(input);
      return { id: 500, url: 'https://tienda.es/post-500', warnings: [] };
    },
    updatePost: async () => ({ warnings: [] }),
    searchProducts: async () => [
      {
        id: 12,
        name: 'Vitrina LED',
        url: 'https://tienda.es/vitrina',
        price: '59,90 EUR',
        imageId: 301,
      },
      { id: 13, name: 'Peana', url: 'https://tienda.es/peana', price: null, imageId: null },
    ],
    listAuthors: async () => [{ id: 7, name: 'Ana' }],
    getPostsInfo: async () => [],
    listAttributedOrders: async () => null,
  };
}

describe.skipIf(!db)('pipeline (integración con Postgres)', () => {
  const prisma = db?.prisma as PrismaClient; // solo se usa si db existe (describe.skipIf)
  let dispatcher: FakeDispatcher;
  let adapter: ReturnType<typeof fakeAdapter>;
  let orgId: string;
  let siteId: string;

  const ctxWith = (claude: ClaudeClient = fakeClaude()): PipelineContext => ({
    prisma,
    claude,
    dispatcher,
    encryptionKey: randomBytes(32),
    config: { defaultModel: 'claude-sonnet-5', freePlanMaxArticles: 2, allowPrivateHosts: true },
    log,
    adapterFactory: () => adapter,
    sleep: async () => undefined,
  });

  /** Ejecuta todo lo encolado, en orden, como haría el worker. */
  async function drain(ctx: PipelineContext, attempt = 1, maxAttempts = 3): Promise<void> {
    while (dispatcher.queue.length) {
      const job = dispatcher.queue.shift()!;
      await runPipelineJob(ctx, job.type, {
        jobRunId: job.jobRunId,
        siteId: job.input.siteId,
        refId: job.input.refId,
        chain: job.input.chain,
        attempt,
        maxAttempts,
      });
    }
  }

  beforeAll(() => undefined);
  afterAll(async () => prisma.$disconnect());
  beforeEach(async () => {
    await resetDatabase(prisma);
    dispatcher = new FakeDispatcher(prisma);
    adapter = fakeAdapter();
    const org = await prisma.organization.create({ data: { name: 'Org', plan: 'free' } });
    orgId = org.id;
    const site = await prisma.site.create({
      data: {
        organizationId: org.id,
        name: 'Tienda',
        url: 'https://tienda.es',
        credentials: 'x',
        settings: { ...DEFAULT_SETTINGS, wordCount: 300 },
      },
    });
    siteId = site.id;
  });

  async function newKeyword(term = 'figuras de acción', status = 'pending', score = 50) {
    return prisma.keyword.create({ data: { siteId, term, status, score } });
  }

  it('keyword → outline → write → publish, con enlaces saneados, uso y JobRuns', async () => {
    const kw = await newKeyword();
    const ctx = ctxWith();
    await dispatcher.enqueue('outline', { siteId, refId: kw.id, chain: 'publish' });
    await drain(ctx);

    const article = await prisma.article.findFirstOrThrow({ where: { siteId } });
    expect(article.status).toBe('published');
    expect(article.remotePostId).toBe(500);
    expect(article.remoteUrl).toBe('https://tienda.es/post-500');
    expect(article.contentHtml).toContain('https://tienda.es/ok');
    expect(article.contentHtml).not.toContain('inventado.com'); // el modelo no puede inventar enlaces
    expect(article.wordCount).toBeGreaterThan(250);
    expect(article.metaDescription!.length).toBeLessThanOrEqual(155);
    expect((await prisma.keyword.findUniqueOrThrow({ where: { id: kw.id } })).status).toBe('done');

    // Publicado como borrador (autoPublish=false) con SEO de Yoast.
    expect(adapter.created[0]).toMatchObject({
      status: 'draft',
      seo: { focusKeyword: 'figuras de acción' },
    });

    const runs = await prisma.jobRun.findMany({ where: { siteId }, orderBy: { createdAt: 'asc' } });
    expect(runs.map((r) => [r.type, r.status])).toEqual([
      ['outline', 'succeeded'],
      ['write', 'succeeded'],
      ['publish', 'succeeded'],
    ]);
    expect(runs[0]!.meta).toMatchObject({ inputTokens: 1000, outputTokens: 500 });
    expect(runs[0]!.startedAt).toBeTruthy();
    expect(runs[0]!.finishedAt).toBeTruthy();

    const usage = await prisma.usageRecord.findFirstOrThrow({ where: { siteId } });
    expect(usage).toMatchObject({ articles: 1, inputTokens: 2000, outputTokens: 1000 });
    expect(usage.costCents).toBeGreaterThan(0);
  });

  it('calidad: SERP en el esquema, tarjeta de producto, imagen destacada, autor y JSON-LD FAQ', async () => {
    await prisma.site.update({
      where: { id: siteId },
      data: { settings: { ...DEFAULT_SETTINGS, wordCount: 300, authorId: 7, seoPlugin: 'yoast' } },
    });
    const kw = await newKeyword();
    const html =
      '<h2>Intro</h2><p>' +
      'palabra '.repeat(300) +
      '</p><p>La vitrina LED protege del polvo.</p><p>[[product:12]]</p><p>[[product:999]]</p>' +
      '<h2>Preguntas frecuentes</h2><h3>¿Cuánto polvo?</h3><p>Poco si está cerrada.</p><h3>¿Luz?</h3><p>LED de bajo consumo.</p>';
    const claude = fakeClaude({
      'Submit the finished article body as HTML.': () => ({ contentHtml: html }),
    });
    const fetchFn = vi.fn(async (u: string | URL | Request) =>
      String(u).startsWith('https://serpapi.com')
        ? new Response(
            JSON.stringify({
              organic_results: [
                { position: 1, title: 'Guía rival', link: 'https://rival.es/g', snippet: 's' },
              ],
              related_questions: [{ question: '¿Qué vitrina comprar?' }],
            }),
          )
        : new Response('<h2>Qué es una figura</h2><p>texto</p>', {
            headers: { 'content-type': 'text/html' },
          }),
    );
    const ctx = {
      ...ctxWith(claude),
      fetchFn: fetchFn as unknown as typeof fetch,
      config: { ...ctxWith().config, serpApiKey: 'serp-key' },
    };
    await dispatcher.enqueue('outline', { siteId, refId: kw.id, chain: 'publish' });
    await drain(ctx);

    const outlineCall = (claude.callTool as ReturnType<typeof vi.fn>).mock.calls.find(
      (c) =>
        (c[0] as { toolDescription: string }).toolDescription === 'Submit the article outline.',
    )?.[0] as { user: string };
    expect(outlineCall.user).toContain('Guía rival');
    expect(outlineCall.user).toContain('- Qué es una figura');
    expect(outlineCall.user).toContain('¿Qué vitrina comprar?');
    const writeCall = (claude.callTool as ReturnType<typeof vi.fn>).mock.calls.find(
      (c) =>
        (c[0] as { toolDescription: string }).toolDescription ===
        'Submit the finished article body as HTML.',
    )?.[0] as { user: string };
    expect(writeCall.user).toContain('ID 12: Vitrina LED (59,90 EUR)');

    const article = await prisma.article.findFirstOrThrow({ where: { siteId } });
    expect(article.serp).toMatchObject({
      query: 'figuras de acción',
      results: [{ title: 'Guía rival' }],
    });
    expect(article.contentHtml).toContain('[products ids="12" columns="1"]');
    expect(article.contentHtml).not.toContain('999');
    expect(article.featuredMediaId).toBe(301);

    const sent = adapter.created[0] as {
      authorId: number;
      featuredMediaId: number;
      seo: { schemaJson: string };
    };
    expect(sent).toMatchObject({ authorId: 7, featuredMediaId: 301 });
    const schema = JSON.parse(sent.seo.schemaJson);
    // Con Yoast activo no se duplica Article: solo el FAQ visible.
    expect(schema['@graph'].map((n: { '@type': string }) => n['@type'])).toEqual(['FAQPage']);
    expect(schema['@graph'][0].mainEntity[0].name).toBe('¿Cuánto polvo?');
  });

  it('con chain=ready se detiene en ready (no publica)', async () => {
    const kw = await newKeyword();
    await dispatcher.enqueue('outline', { siteId, refId: kw.id, chain: 'ready' });
    await drain(ctxWith());
    expect((await prisma.article.findFirstOrThrow({ where: { siteId } })).status).toBe('ready');
    expect(adapter.created).toHaveLength(0);
  });

  it('es idempotente: repetir outline/write no duplica ni vuelve a gastar', async () => {
    const kw = await newKeyword();
    const claude = fakeClaude();
    const ctx = ctxWith(claude);
    await dispatcher.enqueue('outline', { siteId, refId: kw.id, chain: 'ready' });
    await drain(ctx);
    const calls = vi.mocked(claude.callTool).mock.calls.length;

    await dispatcher.enqueue('outline', { siteId, refId: kw.id, chain: 'ready' });
    await drain(ctx);
    const article = await prisma.article.findFirstOrThrow({ where: { siteId } });
    await dispatcher.enqueue('write', { siteId, refId: article.id });
    await drain(ctx);

    expect(await prisma.article.count({ where: { siteId } })).toBe(1);
    expect(vi.mocked(claude.callTool).mock.calls.length).toBe(calls);
    const skipped = await prisma.jobRun.count({
      where: { siteId, status: 'succeeded', meta: { path: ['skipped'], equals: true } },
    });
    expect(skipped).toBe(2);
  });

  it('error no reintentable (truncamiento): JobRun failed y estados failed', async () => {
    const kw = await newKeyword();
    const ctx = ctxWith(
      fakeClaude({
        'Submit the finished article body as HTML.': () => {
          throw new AppError('AI_TRUNCATED', 'cut', { retryable: false });
        },
      }),
    );
    await dispatcher.enqueue('outline', { siteId, refId: kw.id, chain: 'ready' });
    await expect(drain(ctx)).rejects.toMatchObject({ code: 'AI_TRUNCATED' });
    const w = await prisma.jobRun.findFirstOrThrow({ where: { siteId, type: 'write' } });
    expect(w.status).toBe('failed');
    expect(w.error).toContain('AI_TRUNCATED');
    expect((await prisma.article.findFirstOrThrow({ where: { siteId } })).status).toBe('failed');
    expect((await prisma.keyword.findUniqueOrThrow({ where: { id: kw.id } })).status).toBe(
      'failed',
    );
  });

  it('error reintentable con intentos restantes: vuelve a queued, no a failed', async () => {
    const kw = await newKeyword();
    const ctx = ctxWith(
      fakeClaude({
        'Submit the article outline.': () => {
          throw new AppError('RATE_LIMITED', '429', { retryable: true });
        },
      }),
    );
    await dispatcher.enqueue('outline', { siteId, refId: kw.id });
    await expect(drain(ctx, 1, 3)).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    expect((await prisma.jobRun.findFirstOrThrow({ where: { siteId } })).status).toBe('queued');
    expect((await prisma.keyword.findUniqueOrThrow({ where: { id: kw.id } })).status).toBe(
      'queued',
    );
  });

  it('el mismo error en el último intento deja el trabajo en failed', async () => {
    const kw = await newKeyword();
    const ctx = ctxWith(
      fakeClaude({
        'Submit the article outline.': () => {
          throw new AppError('RATE_LIMITED', '429', { retryable: true });
        },
      }),
    );
    await dispatcher.enqueue('outline', { siteId, refId: kw.id });
    await expect(drain(ctx, 3, 3)).rejects.toBeTruthy();
    expect((await prisma.jobRun.findFirstOrThrow({ where: { siteId } })).status).toBe('failed');
  });

  it('brand-voice guarda el perfil en el sitio', async () => {
    const ctx = ctxWith();
    await dispatcher.enqueue('brand-voice', { siteId });
    await drain(ctx);
    expect(
      (await prisma.site.findUniqueOrThrow({ where: { id: siteId } })).brandVoice,
    ).toHaveLength(250);
  });

  it('discover: puntúa con Claude e inserta solo lo que se queda, sin duplicar', async () => {
    await prisma.site.update({
      where: { id: siteId },
      data: { settings: { ...DEFAULT_SETTINGS, seeds: ['figuras'] } },
    });
    await newKeyword('figuras baratas', 'pending', 10); // ya existe: no se vuelve a puntuar
    const fetchFn = vi.fn(
      async () =>
        new Response(
          JSON.stringify(['q', ['figuras baratas', 'figuras de resina', 'figuras de disney']]),
        ),
    );
    const claude = fakeClaude({
      'Submit the evaluation of every candidate keyword.': () => ({
        keywords: [
          { term: 'figuras de resina', keep: true, score: 80, intent: 'commercial' },
          { term: 'figuras de disney', keep: false, score: 0, intent: 'commercial' },
        ],
      }),
    });
    const ctx = { ...ctxWith(claude), fetchFn: fetchFn as unknown as typeof fetch };
    await dispatcher.enqueue('discover', { siteId });
    await drain(ctx);
    await dispatcher.enqueue('discover', { siteId });
    await drain(ctx);

    const kws = await prisma.keyword.findMany({ where: { siteId }, orderBy: { term: 'asc' } });
    expect(kws.map((k) => k.term)).toEqual(['figuras baratas', 'figuras de resina']);
    expect(kws[1]).toMatchObject({
      score: 80,
      intent: 'commercial',
      source: 'autocomplete',
      seedTerm: 'figuras',
      status: 'pending',
    });
  });

  it('alta guiada: el primer discover redacta el primer artículo (hasta ready) y solo una vez', async () => {
    await prisma.site.update({
      where: { id: siteId },
      data: { settings: { ...DEFAULT_SETTINGS, seeds: ['figuras'], onboarding: 'pending' } },
    });
    const fetchFn = vi.fn(
      async () => new Response(JSON.stringify(['q', ['figuras de resina', 'figuras baratas']])),
    );
    const claude = fakeClaude({
      'Submit the evaluation of every candidate keyword.': () => ({
        keywords: [
          { term: 'figuras de resina', keep: true, score: 90, intent: 'commercial' },
          { term: 'figuras baratas', keep: true, score: 40, intent: 'transactional' },
        ],
      }),
    });
    const ctx = { ...ctxWith(claude), fetchFn: fetchFn as unknown as typeof fetch };
    await dispatcher.enqueue('discover', { siteId });
    await drain(ctx);

    const article = await prisma.article.findFirstOrThrow({ where: { siteId } });
    expect(article.status).toBe('ready'); // borrador para revisar: no se publica solo
    const kw = await prisma.keyword.findUniqueOrThrow({ where: { id: article.keywordId! } });
    expect(kw.term).toBe('figuras de resina'); // la de mayor puntuación
    const site = await prisma.site.findUniqueOrThrow({ where: { id: siteId } });
    expect(site.settings).toMatchObject({ onboarding: 'done', seeds: ['figuras'] });
    const discover = await prisma.jobRun.findFirstOrThrow({ where: { siteId, type: 'discover' } });
    expect(discover.meta).toMatchObject({ firstArticle: { started: true, keywordId: kw.id } });

    // Un segundo discover ya no genera nada por su cuenta.
    await dispatcher.enqueue('discover', { siteId });
    await drain(ctx);
    expect(await prisma.article.count({ where: { siteId } })).toBe(1);
  });

  it('alta guiada sin cuota disponible: no encola y deja la keyword pendiente', async () => {
    await prisma.site.update({
      where: { id: siteId },
      data: { settings: { ...DEFAULT_SETTINGS, onboarding: 'pending' } },
    });
    await prisma.usageRecord.create({
      data: { siteId, period: new Date().toISOString().slice(0, 7), articles: 2 },
    });
    const kw = await newKeyword('figuras de resina', 'pending', 90);
    const res = await startFirstArticle(ctxWith(), siteId);
    expect(res).toEqual({ started: false, reason: 'QUOTA_EXCEEDED' });
    expect((await prisma.keyword.findUniqueOrThrow({ where: { id: kw.id } })).status).toBe(
      'pending',
    );
    expect(dispatcher.queue).toHaveLength(0);
  });

  it('discover tolera intent/score raros de Claude: normaliza en vez de fallar el lote', async () => {
    await prisma.site.update({
      where: { id: siteId },
      data: { settings: { ...DEFAULT_SETTINGS, seeds: ['figuras'] } },
    });
    const fetchFn = vi.fn(
      async () => new Response(JSON.stringify(['q', ['figuras a', 'figuras b', 'figuras c']])),
    );
    const claude = fakeClaude({
      'Submit the evaluation of every candidate keyword.': () => ({
        keywords: [
          { term: 'figuras a', keep: true, score: 150.6, intent: 'navigational' },
          { term: 'figuras b', keep: true, score: -3, intent: 'Commercial' },
          { term: 'figuras c', keep: true, score: 40, intent: '' },
        ],
      }),
    });
    const ctx = { ...ctxWith(claude), fetchFn: fetchFn as unknown as typeof fetch };
    await dispatcher.enqueue('discover', { siteId });
    await drain(ctx);
    const by = Object.fromEntries(
      (await prisma.keyword.findMany({ where: { siteId } })).map((k) => [k.term, k]),
    );
    expect(by['figuras a']).toMatchObject({ score: 100, intent: null });
    expect(by['figuras b']).toMatchObject({ score: 0, intent: 'commercial' });
    expect(by['figuras c']).toMatchObject({ score: 40, intent: null });
  });

  it('discover sin seeds las deduce del contenido, las guarda y sigue', async () => {
    const fetchFn = vi.fn(
      async () => new Response(JSON.stringify(['q', ['figuras de resina baratas']])),
    );
    const claude = fakeClaude({
      'Submit the seed keywords that describe the store.': () => ({
        seeds: [
          { term: 'Figuras de Resina', reason: 'categoría principal' },
          { term: 'figuras de resina', reason: 'duplicada' },
          { term: 'dioramas', reason: 'productos' },
        ],
      }),
      'Submit the evaluation of every candidate keyword.': () => ({
        keywords: [
          { term: 'figuras de resina baratas', keep: true, score: 70, intent: 'commercial' },
        ],
      }),
    });
    const ctx = { ...ctxWith(claude), fetchFn: fetchFn as unknown as typeof fetch };
    await dispatcher.enqueue('discover', { siteId });
    await drain(ctx);

    const site = await prisma.site.findUniqueOrThrow({ where: { id: siteId } });
    expect((site.settings as { seeds: string[] }).seeds).toEqual(['figuras de resina', 'dioramas']);
    expect(await prisma.keyword.count({ where: { siteId } })).toBe(1);
    const run = await prisma.jobRun.findFirstOrThrow({ where: { siteId, type: 'discover' } });
    expect(run).toMatchObject({ status: 'succeeded', meta: { seedsGenerated: true, seeds: 2 } });
  });

  it('discover sin seeds ni contenido publicado falla con NO_SEEDS', async () => {
    adapter.listContent = async () => [];
    adapter.listCategories = async () => [];
    await dispatcher.enqueue('discover', { siteId });
    await expect(drain(ctxWith())).rejects.toMatchObject({ code: 'NO_SEEDS' });
  });

  describe('watchdog', () => {
    const backdate = (table: 'Keyword' | 'Article', id: string, minutes: number) =>
      prisma.$executeRawUnsafe(
        `UPDATE "${table}" SET "updatedAt" = NOW() - INTERVAL '${minutes} minutes' WHERE id = '${id}'`,
      );

    it('rescata zombis (keyword processing, article writing/publishing) y lo anota en JobRun', async () => {
      const kw = await newKeyword('zombi', 'processing');
      const a1 = await prisma.article.create({
        data: { siteId, title: 'a', slug: 'a', status: 'writing' },
      });
      const a2 = await prisma.article.create({
        data: { siteId, title: 'b', slug: 'b', status: 'publishing', contentHtml: '<p>x</p>' },
      });
      const fresh = await newKeyword('reciente', 'processing');
      await backdate('Keyword', kw.id, 25);
      await backdate('Article', a1.id, 25);
      await backdate('Article', a2.id, 25);

      const res = await runWatchdog(prisma, log);
      expect(res).toMatchObject({ keywords: 1, articles: 2 });
      expect((await prisma.keyword.findUniqueOrThrow({ where: { id: kw.id } })).status).toBe(
        'pending',
      );
      expect((await prisma.keyword.findUniqueOrThrow({ where: { id: fresh.id } })).status).toBe(
        'processing',
      );
      expect((await prisma.article.findUniqueOrThrow({ where: { id: a1.id } })).status).toBe(
        'draft',
      );
      expect((await prisma.article.findUniqueOrThrow({ where: { id: a2.id } })).status).toBe(
        'ready',
      );
      const note = await prisma.jobRun.findFirstOrThrow({ where: { siteId, type: 'watchdog' } });
      expect(note.meta).toMatchObject({ recoveredKeywords: [kw.id] });
    });

    it('cierra JobRun colgados en running', async () => {
      const run = await prisma.jobRun.create({
        data: {
          siteId,
          type: 'write',
          status: 'running',
          startedAt: new Date(Date.now() - 45 * 60_000),
        },
      });
      await runWatchdog(prisma, log);
      const after = await prisma.jobRun.findUniqueOrThrow({ where: { id: run.id } });
      expect(after.status).toBe('failed');
      expect(after.error).toContain('WATCHDOG_TIMEOUT');
    });

    it('una keyword rescatada puede reanudar la cadena sin duplicar el esquema', async () => {
      const kw = await newKeyword('reanudar', 'processing');
      await prisma.article.create({
        data: {
          siteId,
          keywordId: kw.id,
          title: 't',
          slug: 't',
          status: 'draft',
          outline: {
            title: 't',
            slug: 't',
            metaDescription: 'm'.repeat(30),
            sections: [],
            faq: [],
          },
        },
      });
      await backdate('Keyword', kw.id, 30);
      await runWatchdog(prisma, log);
      const ctx = ctxWith();
      await dispatcher.enqueue('outline', { siteId, refId: kw.id, chain: 'ready' });
      await drain(ctx);
      expect(await prisma.article.count({ where: { siteId } })).toBe(1);
      expect((await prisma.article.findFirstOrThrow({ where: { siteId } })).status).toBe('ready');
    });
  });

  describe('scheduler', () => {
    it('cadencia diaria: lanza la mejor keyword una vez y no repite antes de tiempo', async () => {
      await prisma.site.update({
        where: { id: siteId },
        data: { settings: { ...DEFAULT_SETTINGS, cadence: 'daily' } },
      });
      await newKeyword('floja', 'pending', 10);
      const best = await newKeyword('estrella', 'pending', 90);
      const ctx = ctxWith();

      const first = await runScheduler(ctx);
      expect(first.generated).toBe(1);
      expect(dispatcher.queue[0]).toMatchObject({
        type: 'outline',
        input: { refId: best.id, chain: 'publish' },
      });
      expect((await prisma.keyword.findUniqueOrThrow({ where: { id: best.id } })).status).toBe(
        'queued',
      );

      expect((await runScheduler(ctx)).generated).toBe(0);
      const tomorrow = new Date(Date.now() + 23 * 3_600_000);
      expect((await runScheduler(ctx, tomorrow)).generated).toBe(1);
    });

    it('cadencia off no hace nada; sin keywords ni seeds lanza discover (las deduce)', async () => {
      await newKeyword('x', 'pending');
      expect((await runScheduler(ctxWith())).generated).toBe(0);
      await prisma.site.update({
        where: { id: siteId },
        data: { settings: { ...DEFAULT_SETTINGS, cadence: 'daily' } },
      });
      await prisma.keyword.deleteMany({ where: { siteId } });
      expect(await runScheduler(ctxWith())).toMatchObject({ generated: 0, discovered: 1 });
      expect(dispatcher.queue.map((j) => j.type)).toEqual(['discover']);
    });
  });

  describe('cuotas', () => {
    it('plan free: bloquea al llegar al tope mensual', async () => {
      const cfg = { freePlanMaxArticles: 2 };
      await expect(assertQuota(prisma, siteId, 'generate_article', cfg)).resolves.toBeUndefined();
      await prisma.usageRecord.create({
        data: { siteId, period: new Date().toISOString().slice(0, 7), articles: 2 },
      });
      await expect(assertQuota(prisma, siteId, 'generate_article', cfg)).rejects.toMatchObject({
        code: 'QUOTA_EXCEEDED',
      });
    });
    it('cada plan de pago tiene su propio tope (pro 100, agency 400)', async () => {
      const cfg = { freePlanMaxArticles: 2 };
      await prisma.organization.update({ where: { id: orgId }, data: { plan: 'pro' } });
      await prisma.usageRecord.create({
        data: { siteId, period: new Date().toISOString().slice(0, 7), articles: 99 },
      });
      await expect(assertQuota(prisma, siteId, 'generate_article', cfg)).resolves.toBeUndefined();
      await prisma.usageRecord.updateMany({ where: { siteId }, data: { articles: 100 } });
      await expect(assertQuota(prisma, siteId, 'generate_article', cfg)).rejects.toMatchObject({
        code: 'QUOTA_EXCEEDED',
      });
      await prisma.organization.update({ where: { id: orgId }, data: { plan: 'agency' } });
      await prisma.usageRecord.updateMany({ where: { siteId }, data: { articles: 399 } });
      await expect(assertQuota(prisma, siteId, 'generate_article', cfg)).resolves.toBeUndefined();
      await prisma.usageRecord.updateMany({ where: { siteId }, data: { articles: 400 } });
      await expect(assertQuota(prisma, siteId, 'generate_article', cfg)).rejects.toMatchObject({
        code: 'QUOTA_EXCEEDED',
      });
    });
  });

  describe('aislamiento multi-tenant', () => {
    it('un sitio ajeno es NOT_FOUND y siteScope fuerza el siteId', async () => {
      const other = await prisma.organization.create({ data: { name: 'Otra' } });
      const foreign = await prisma.site.create({
        data: { organizationId: other.id, name: 'Ajeno', url: 'https://x.com', credentials: '' },
      });
      await prisma.keyword.create({ data: { siteId: foreign.id, term: 'secreta' } });
      await newKeyword('mia');

      await expect(requireSite(prisma, orgId, foreign.id)).rejects.toMatchObject({
        code: 'NOT_FOUND',
        httpStatus: 404,
      });
      const scope = siteScope(prisma, siteId);
      const rows = await scope.keywords.findMany({ where: { siteId: foreign.id } as never });
      expect(rows.map((r) => r.term)).toEqual(['mia']);
      const foreignKw = await prisma.keyword.findFirstOrThrow({ where: { siteId: foreign.id } });
      expect(await scope.keywords.findById(foreignKw.id)).toBeNull();
      await expect(scope.keywords.deleteById(foreignKw.id)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });
  });
});
