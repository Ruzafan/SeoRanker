import { randomBytes } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { resetDatabase, setupTestDatabase } from '@seo/db/testing';
import type { PrismaClient } from '@seo/db';
import { DEFAULT_SETTINGS } from '@seo/shared';
import type { AttributedOrder, PostInfo, PublishingAdapter } from '../adapters/index.js';
import type { ClaudeClient } from '../ai/claude.js';
import { encryptJson } from '../crypto.js';
import { matchProperty, urlKey } from '../integrations/google.js';
import type { EnqueueInput, JobDispatcher, PipelineJobType } from '../queue.js';
import { getPerformance } from '../services/performance.js';
import type { PipelineContext } from './context.js';
import { runPipelineJob } from './index.js';
import { runSyncScheduler } from './scheduler.js';
import { opportunityScore } from './sync.js';

describe('utilidades de Search Console', () => {
  it('urlKey ignora protocolo, www, query y barra final', () => {
    expect(urlKey('https://www.Tienda.es/guia/?utm=x#a')).toBe('tienda.es/guia');
    expect(urlKey('http://tienda.es/guia')).toBe('tienda.es/guia');
  });
  it('matchProperty prefiere la propiedad de dominio y si no el prefijo más largo', () => {
    const props = ['https://tienda.es/', 'https://tienda.es/blog/', 'https://otra.com/'];
    expect(matchProperty('https://tienda.es', [...props, 'sc-domain:tienda.es'])).toBe(
      'sc-domain:tienda.es',
    );
    expect(matchProperty('https://www.tienda.es/blog', props)).toBe('https://tienda.es/blog/');
    expect(matchProperty('https://nada.es', props)).toBeNull();
  });
  it('opportunityScore premia impresiones y cercanía a la primera página', () => {
    expect(opportunityScore(1000, 9)).toBeGreaterThan(opportunityScore(1000, 18));
    expect(opportunityScore(5000, 12)).toBeGreaterThan(opportunityScore(50, 12));
    expect(opportunityScore(10, 20)).toBeGreaterThanOrEqual(1);
  });
});

const db = await setupTestDatabase('core_sync');
const log = { info: () => undefined, warn: () => undefined, error: () => undefined };
const DAY = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);

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

describe.skipIf(!db)('sync (integración con Postgres)', () => {
  const prisma = db?.prisma as PrismaClient;
  const key = randomBytes(32);
  let dispatcher: FakeDispatcher;
  let siteId: string;
  let orgId: string;
  let posts: PostInfo[];
  let orders: AttributedOrder[];
  let gscCalls: { url: string; body: unknown }[];
  let gscRows: (body: { dimensions: string[] }) => unknown[];
  let tokenStatus = 200;

  const adapter = (): PublishingAdapter =>
    ({
      getPostsInfo: async (ids: number[]) => posts.filter((p) => ids.includes(p.id)),
      listAttributedOrders: async () => ({ orders, hasMore: false }),
    }) as unknown as PublishingAdapter;

  const fetchFn = (async (u: string | URL | Request, init?: RequestInit) => {
    const url = String(u);
    if (url.includes('oauth2.googleapis.com/token')) {
      return new Response(
        JSON.stringify(tokenStatus === 200 ? { access_token: 'at' } : { error: 'invalid_grant' }),
        {
          status: tokenStatus,
        },
      );
    }
    if (url.includes('/searchAnalytics/query')) {
      const body = JSON.parse(String(init?.body)) as { dimensions: string[]; startRow: number };
      gscCalls.push({ url, body });
      return new Response(JSON.stringify({ rows: body.startRow > 0 ? [] : gscRows(body) }));
    }
    return new Response('{}', { status: 404 });
  }) as typeof fetch;

  const ctx = (): PipelineContext => ({
    prisma,
    claude: {} as ClaudeClient,
    dispatcher,
    encryptionKey: key,
    config: {
      defaultModel: 'm',
      freePlanMaxArticles: 3,
      allowPrivateHosts: true,
      google: { clientId: 'id', clientSecret: 'secret', redirectUri: '' },
    },
    log,
    fetchFn,
    adapterFactory: adapter,
  });

  async function runSync() {
    await dispatcher.enqueue('sync', { siteId });
    const job = dispatcher.queue.shift()!;
    await runPipelineJob(ctx(), 'sync', {
      jobRunId: job.jobRunId,
      siteId,
      attempt: 1,
      maxAttempts: 3,
    });
    return prisma.jobRun.findUniqueOrThrow({ where: { id: job.jobRunId } });
  }

  beforeEach(async () => {
    await resetDatabase(prisma);
    dispatcher = new FakeDispatcher(prisma);
    gscCalls = [];
    tokenStatus = 200;
    const org = await prisma.organization.create({ data: { name: 'Org', plan: 'pro' } });
    orgId = org.id;
    const site = await prisma.site.create({
      data: {
        organizationId: org.id,
        name: 'Figuras Top',
        url: 'https://tienda.es',
        credentials: 'x',
        settings: { ...DEFAULT_SETTINGS, woocommerce: true },
      },
    });
    siteId = site.id;
    await prisma.searchConsoleConnection.create({
      data: {
        siteId,
        credentials: encryptJson(key, { refreshToken: 'rt' }),
        propertyUrl: 'sc-domain:tienda.es',
      },
    });
    posts = [];
    orders = [];
  });
  afterAll(async () => prisma.$disconnect());

  it('actualiza URL/estado de los posts, guarda métricas por artículo, oportunidades, caída y ventas', async () => {
    const [a1, a2] = await Promise.all(
      [1, 2].map((n) =>
        prisma.article.create({
          data: {
            siteId,
            title: `Guía ${n}`,
            slug: `guia-${n}`,
            status: 'published',
            remotePostId: n,
            remoteUrl: `https://tienda.es/?p=${n}`,
          },
        }),
      ),
    );
    posts = [
      { id: 1, url: 'https://tienda.es/guia-1/', status: 'publish' },
      { id: 2, url: 'https://tienda.es/guia-2/', status: 'publish' },
    ];
    await prisma.keyword.create({ data: { siteId, term: 'limpiar figuras', score: 10 } });

    const today = new Date();
    const end = new Date(today.getTime() - 2 * DAY);
    const days = Array.from({ length: 60 }, (_, i) => iso(new Date(end.getTime() - i * DAY)));
    gscRows = (body) => {
      if (body.dimensions.join() === 'date,page') {
        // guia-1 cae: 5 clics/día hace 29-56 días, 1/día los últimos 28. guia-2 estable.
        return days.flatMap((d, i) => [
          {
            keys: [d, 'https://tienda.es/guia-1/'],
            clicks: i < 28 ? 1 : 5,
            impressions: 100,
            ctr: 0,
            position: 6,
          },
          {
            keys: [d, 'http://www.tienda.es/guia-1'],
            clicks: 0,
            impressions: 100,
            ctr: 0,
            position: 10,
          },
          {
            keys: [d, 'https://tienda.es/guia-2/'],
            clicks: 2,
            impressions: 50,
            ctr: 0,
            position: 12,
          },
          { keys: [d, 'https://tienda.es/'], clicks: 9, impressions: 900, ctr: 0, position: 3 },
        ]);
      }
      return [
        // Oportunidad: posición 11 con 300 impresiones, posicionada por la home (no por un artículo).
        {
          keys: ['figuras de resina baratas', 'https://tienda.es/'],
          clicks: 3,
          impressions: 300,
          ctr: 0,
          position: 11,
        },
        // Ya la posiciona un artículo nuestro: es un refresco, no un artículo nuevo.
        {
          keys: ['guia completa figuras', 'https://tienda.es/guia-1/'],
          clicks: 1,
          impressions: 200,
          ctr: 0,
          position: 12,
        },
        // De marca, demasiado arriba, pocas impresiones o una sola palabra: fuera.
        {
          keys: ['figuras top opiniones', 'https://tienda.es/'],
          clicks: 1,
          impressions: 500,
          ctr: 0,
          position: 9,
        },
        {
          keys: ['figuras resina', 'https://tienda.es/'],
          clicks: 50,
          impressions: 900,
          ctr: 0,
          position: 3,
        },
        {
          keys: ['figuras raras', 'https://tienda.es/'],
          clicks: 0,
          impressions: 5,
          ctr: 0,
          position: 15,
        },
        {
          keys: ['figuras', 'https://tienda.es/'],
          clicks: 0,
          impressions: 900,
          ctr: 0,
          position: 15,
        },
        // Existe como keyword: solo se actualizan sus métricas.
        {
          keys: ['limpiar figuras', 'https://tienda.es/'],
          clicks: 4,
          impressions: 80,
          ctr: 0,
          position: 14,
        },
      ];
    };
    orders = [
      {
        id: '20',
        total: 99.8,
        currency: 'EUR',
        createdAt: today.toISOString(),
        entry: 'https://tienda.es/guia-2/?utm_x=1',
        sourceType: 'organic',
      },
      {
        id: '21',
        total: 10,
        currency: 'EUR',
        createdAt: today.toISOString(),
        entry: 'https://tienda.es/carrito/',
        sourceType: 'direct',
      },
    ];

    const run = await runSync();
    expect(run.status).toBe('succeeded');
    expect(run.meta).toMatchObject({
      posts: { checked: 2, updated: 2 },
      searchConsole: { opportunities: { created: 1, updated: 1 }, decay: { flagged: 1 } },
      orders: { seen: 2, attributed: 1 },
    });

    const art1 = await prisma.article.findUniqueOrThrow({ where: { id: a1!.id } });
    expect(art1).toMatchObject({ remoteUrl: 'https://tienda.es/guia-1/', remoteStatus: 'publish' });
    expect(art1.decayDetectedAt).not.toBeNull();
    // Dos URL del mismo artículo se agregan; la home no es un artículo.
    const m = await prisma.articleMetric.findFirstOrThrow({
      where: { articleId: a1!.id, date: new Date(`${days[0]}T00:00:00Z`) },
    });
    expect(m).toMatchObject({ clicks: 1, impressions: 200, position: 8 });
    expect(await prisma.articleMetric.count({ where: { siteId } })).toBe(120);

    const kws = await prisma.keyword.findMany({ where: { siteId }, orderBy: { term: 'asc' } });
    expect(kws.map((k) => [k.term, k.source])).toEqual([
      ['figuras de resina baratas', 'gsc'],
      ['limpiar figuras', 'manual'],
    ]);
    expect(kws[0]).toMatchObject({ gscImpressions: 300, gscPosition: 11, status: 'pending' });
    expect(kws[1]).toMatchObject({ gscImpressions: 80, gscClicks: 4, score: 10 });

    const conv = await prisma.articleConversion.findMany({ where: { siteId } });
    expect(conv).toHaveLength(1);
    expect(conv[0]).toMatchObject({ articleId: a2!.id, orderId: '20', total: 99.8 });
    const conn = await prisma.searchConsoleConnection.findUniqueOrThrow({ where: { siteId } });
    expect(conn.lastSyncAt).not.toBeNull();

    // Segunda pasada: relee solo desde lastSyncAt (con solape) y no duplica pedidos ni keywords.
    gscCalls = [];
    await runSync();
    const start = (gscCalls[0]?.body as { startDate: string }).startDate;
    expect(Date.parse(start)).toBeGreaterThan(Date.now() - 12 * DAY);
    expect(await prisma.articleConversion.count({ where: { siteId } })).toBe(1);
    expect(await prisma.keyword.count({ where: { siteId } })).toBe(2);

    const perf = await getPerformance(
      {
        prisma,
        dispatcher,
        encryptionKey: key,
        config: { allowPrivateHosts: true, freePlanMaxArticles: 3 },
      },
      orgId,
      siteId,
    );
    expect(perf.totals).toMatchObject({
      clicks: 28 + 56,
      revenue: 99.8,
      orders: 1,
      previousClicks: 5 * 28 + 2 * 28,
    });
    expect(perf.articles[0]).toMatchObject({ articleId: a2!.id, clicks: 56, revenue: 99.8 });
    expect(perf.articles[1]).toMatchObject({ articleId: a1!.id, decaying: true, position: 8 });
    expect(perf.opportunities.map((o) => o.term)).toEqual(['figuras de resina baratas']);
    expect(perf.revenueEnabled).toBe(true);
    expect(perf.daily).toHaveLength(60);
  });

  it('sin plan con ventas atribuidas no lee pedidos; token revocado queda anotado en la conexión', async () => {
    await prisma.organization.update({ where: { id: orgId }, data: { plan: 'starter' } });
    tokenStatus = 400;
    gscRows = () => [];
    const run = await runSync();
    expect(run.status).toBe('succeeded'); // las partes fallan por separado
    expect(run.meta).toMatchObject({
      orders: { skipped: 'PLAN_FEATURE_REQUIRED' },
      searchConsole: { error: 'GOOGLE_AUTH_FAILED' },
    });
    const conn = await prisma.searchConsoleConnection.findUniqueOrThrow({ where: { siteId } });
    expect(conn.lastError).toBe('GOOGLE_AUTH_FAILED');
  });

  it('el planificador encola sync una vez al día por sitio con algo que sincronizar', async () => {
    const other = await prisma.site.create({
      data: { organizationId: orgId, name: 'Vacía', url: 'https://vacia.es', credentials: 'x' },
    });
    expect(await runSyncScheduler(ctx())).toEqual({ enqueued: 1 });
    expect(dispatcher.queue.map((q) => q.input.siteId)).toEqual([siteId]);
    expect(await runSyncScheduler(ctx())).toEqual({ enqueued: 0 });
    expect(other.id).toBeTruthy();
  });
});
