import { randomBytes } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetDatabase, setupTestDatabase } from '@seo/db/testing';
import type { PrismaClient } from '@seo/db';
import { DEFAULT_SETTINGS } from '@seo/shared';
import type { CreatePostInput, PublishingAdapter } from '../adapters/index.js';
import type { ClaudeClient } from '../ai/claude.js';
import type { EnqueueInput, JobDispatcher, PipelineJobType } from '../queue.js';
import { patchKeyword } from '../services/keywords.js';
import type { PipelineContext } from './context.js';
import { runPipelineJob } from './index.js';
import { pickNextKeyword } from './scheduler.js';

const db = await setupTestDatabase('core_clusters');
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

const LONG =
  'La vitrina protege las figuras del polvo y de la luz directa del sol durante años enteros. Conviene colocarla lejos de ventanas y radiadores.';

describe.skipIf(!db)('clusters, canibalización y enlazado inverso', () => {
  const prisma = db?.prisma as PrismaClient;
  let dispatcher: FakeDispatcher;
  let siteId: string;
  let orgId: string;
  let responders: Record<string, (input: { user: string }) => unknown>;
  let updates: { id: number; input: Partial<CreatePostInput> }[];
  let failUpdate = false;

  const claude = {
    callTool: vi.fn(async (input: { toolDescription: string; user: string }) => ({
      data: responders[input.toolDescription]?.(input),
      usage: { inputTokens: 100, outputTokens: 50 },
      model: 'claude-sonnet-5',
    })),
  } as unknown as ClaudeClient;

  const adapter = {
    listContent: async () => [
      {
        id: 9,
        title: 'Guía de vitrinas LED para figuras',
        url: 'https://t.es/vitrinas',
        type: 'post',
      },
    ],
    updatePost: async (id: number, input: Partial<CreatePostInput>) => {
      if (failUpdate) throw new Error('wp down');
      updates.push({ id, input });
      return { warnings: [] };
    },
  } as unknown as PublishingAdapter;

  const ctx = (): PipelineContext => ({
    prisma,
    claude,
    dispatcher,
    encryptionKey: randomBytes(32),
    config: { defaultModel: 'm', freePlanMaxArticles: 50, allowPrivateHosts: true },
    log,
    adapterFactory: () => adapter,
  });

  async function run(type: PipelineJobType, refId?: string) {
    await dispatcher.enqueue(type, { siteId, refId });
    const job = dispatcher.queue.pop()!;
    await runPipelineJob(ctx(), type, {
      jobRunId: job.jobRunId,
      siteId,
      refId,
      attempt: 1,
      maxAttempts: 3,
    });
    return prisma.jobRun.findUniqueOrThrow({ where: { id: job.jobRunId } });
  }

  beforeEach(async () => {
    await resetDatabase(prisma);
    dispatcher = new FakeDispatcher(prisma);
    responders = {};
    updates = [];
    failUpdate = false;
    const org = await prisma.organization.create({ data: { name: 'O', plan: 'pro' } });
    orgId = org.id;
    siteId = (
      await prisma.site.create({
        data: {
          organizationId: org.id,
          name: 'T',
          url: 'https://t.es',
          credentials: 'x',
          settings: DEFAULT_SETTINGS,
        },
      })
    ).id;
  });
  afterAll(async () => prisma.$disconnect());

  it('canibalización: no escribe otro artículo para la misma intención; recuperarla lo fuerza', async () => {
    const old = await prisma.keyword.create({
      data: { siteId, term: 'limpiar figuras de resina', status: 'done' },
    });
    const existing = await prisma.article.create({
      data: { siteId, keywordId: old.id, title: 'Cómo limpiar figuras de resina', slug: 'x' },
    });
    const kw = await prisma.keyword.create({
      data: { siteId, term: 'como limpiar una figura de resina', status: 'queued' },
    });
    const job = await run('outline', kw.id);
    expect(job.status).toBe('succeeded');
    expect(job.meta).toMatchObject({ skipped: 'CANNIBALIZATION', similarTo: existing.id });
    expect(await prisma.keyword.findUniqueOrThrow({ where: { id: kw.id } })).toMatchObject({
      status: 'discarded',
      discardReason: 'CANNIBALIZATION',
      similarToArticleId: existing.id,
    });
    expect(claude.callTool).not.toHaveBeenCalled(); // no se gastó nada

    // También contra los posts del blog que no generamos nosotros.
    const blogKw = await prisma.keyword.create({
      data: { siteId, term: 'vitrinas led para figuras', status: 'queued' },
    });
    expect((await run('outline', blogKw.id)).meta).toMatchObject({
      skipped: 'CANNIBALIZATION',
      similarTo: 'wp:https://t.es/vitrinas',
    });

    // El usuario la recupera: queda autorizada y ya no se descarta.
    const recovered = await patchKeyword(
      {
        prisma,
        dispatcher,
        encryptionKey: randomBytes(32),
        config: { allowPrivateHosts: true, freePlanMaxArticles: 5 },
      },
      orgId,
      kw.id,
      { status: 'pending' },
    );
    expect(recovered).toMatchObject({ allowSimilar: true, discardReason: null });
  });

  it('clusters: agrupa, marca la pilar y el planificador escribe pilar → satélites → resto', async () => {
    const terms = [
      'figuras de resina',
      'limpiar figuras de resina',
      'pintar figuras de resina',
      'vitrinas led',
      'peanas',
    ];
    const kws = await Promise.all(
      terms.map((term, i) => prisma.keyword.create({ data: { siteId, term, score: 90 - i * 10 } })),
    );
    responders['Submit the topic clusters.'] = () => ({
      clusters: [
        {
          name: 'Resina',
          pillar: 'Figuras de Resina',
          keywords: [
            'figuras de resina',
            'limpiar figuras de resina',
            'pintar figuras de resina',
            'inventada',
          ],
        },
        {
          name: 'Exposición',
          pillar: 'no-existe',
          keywords: ['vitrinas led', 'figuras de resina'],
        },
      ],
    });
    const job = await run('cluster');
    expect(job.meta).toMatchObject({ clusters: 2, keywords: 5, unassigned: 1 });
    const clusters = await prisma.keywordCluster.findMany({
      where: { siteId },
      orderBy: { name: 'asc' },
    });
    expect(clusters.map((c) => c.name)).toEqual(['Exposición', 'Resina']);
    expect(clusters[1]!.pillarKeywordId).toBe(kws[0]!.id);
    expect(clusters[0]!.pillarKeywordId).toBe(kws[3]!.id); // pilar inválida → la primera del cluster

    // Mayor score es la pilar "figuras de resina"; después "vitrinas" (pilar); luego satélites.
    expect((await pickNextKeyword(ctx(), siteId))?.term).toBe('figuras de resina');
    await prisma.keyword.update({ where: { id: kws[0]!.id }, data: { status: 'done' } });
    expect((await pickNextKeyword(ctx(), siteId))?.term).toBe('vitrinas led');
    await prisma.keyword.update({ where: { id: kws[3]!.id }, data: { status: 'queued' } });
    expect((await pickNextKeyword(ctx(), siteId))?.term).toBe('limpiar figuras de resina');

    // Reagrupar sustituye los clusters anteriores.
    responders['Submit the topic clusters.'] = () => ({
      clusters: [{ name: 'Todo', pillar: 'peanas', keywords: terms }],
    });
    await run('cluster');
    expect(await prisma.keywordCluster.count({ where: { siteId } })).toBe(1);
  });

  it('enlazado inverso: enlaza desde artículos relacionados, valida el párrafo y actualiza WordPress', async () => {
    const cluster = await prisma.keywordCluster.create({ data: { siteId, name: 'Resina' } });
    const mk = async (term: string, n: number, html: string, remoteStatus = 'publish') => {
      const kw = await prisma.keyword.create({
        data: { siteId, term, clusterId: cluster.id, status: 'done' },
      });
      return prisma.article.create({
        data: {
          siteId,
          keywordId: kw.id,
          title: term,
          slug: `a${n}`,
          status: 'published',
          remotePostId: n,
          remoteUrl: `https://t.es/a${n}/`,
          remoteStatus,
          contentHtml: html,
        },
      });
    };
    const target = await mk('limpiar figuras de resina', 1, '<p>x</p>');
    const good = await mk(
      'vitrinas para figuras de resina',
      2,
      `<h2>Intro</h2><p>${LONG}</p><p>corto</p>`,
    );
    const bad = await mk('pintar figuras de resina', 3, `<p>${LONG}</p>`);
    await mk('borrador de resina', 4, `<p>${LONG}</p>`, 'draft'); // no publicado: no se toca

    // Primera llamada (a2, mismo cluster y más parecido): reescritura válida. Segunda (a3): reescribe
    // el párrafo entero, así que se rechaza. El párrafo "corto" (<20 palabras) ni se ofrece.
    let calls = 0;
    responders['Submit the paragraph that receives the internal link.'] = (input) => {
      expect(input.user).not.toContain('corto');
      return calls++ === 0
        ? {
            paragraphIndex: 0,
            paragraphHtml: `<p>${LONG} Si ya tienen polvo, repasa <a href="https://t.es/a1/">cómo limpiar figuras de resina</a>.</p>`,
            anchorText: 'cómo limpiar figuras de resina',
          }
        : {
            paragraphIndex: 0,
            paragraphHtml:
              '<p>Otro texto completamente distinto <a href="https://t.es/a1/">limpieza</a></p>',
            anchorText: 'limpieza',
          };
    };
    const job = await run('backlink', target.id);
    expect(job.meta).toMatchObject({ candidates: 2, linked: [good.id], rejected: [bad.id] });
    expect(updates).toHaveLength(1);
    expect(updates[0]!.id).toBe(2);
    expect(updates[0]!.input.content).toContain(
      '<a href="https://t.es/a1/">cómo limpiar figuras de resina</a>',
    );
    const saved = await prisma.article.findUniqueOrThrow({ where: { id: good.id } });
    expect(saved.contentHtml).toBe(updates[0]!.input.content);
    expect(await prisma.internalLink.findMany({ where: { siteId } })).toMatchObject([
      { fromArticleId: good.id, toArticleId: target.id, anchor: 'cómo limpiar figuras de resina' },
    ]);

    // Repetir no vuelve a enlazar desde el mismo artículo.
    const again = await run('backlink', target.id);
    expect(again.meta).toMatchObject({ candidates: 1, linked: [] });
  });

  it('enlazado inverso: si WordPress falla no se cambia el artículo local; destino no publicado → nada', async () => {
    const t = await prisma.article.create({
      data: {
        siteId,
        title: 'Limpiar figuras de resina',
        slug: 't',
        remotePostId: 1,
        remoteUrl: 'https://t.es/?p=1',
        remoteStatus: 'draft',
      },
    });
    expect((await run('backlink', t.id)).meta).toMatchObject({ skipped: 'TARGET_NOT_LIVE' });

    await prisma.article.update({
      where: { id: t.id },
      data: { remoteUrl: 'https://t.es/t/', remoteStatus: 'publish' },
    });
    const src = await prisma.article.create({
      data: {
        siteId,
        title: 'Vitrinas para figuras de resina',
        slug: 's',
        remotePostId: 2,
        remoteUrl: 'https://t.es/s/',
        remoteStatus: 'publish',
        contentHtml: `<p>${LONG}</p>`,
      },
    });
    responders['Submit the paragraph that receives the internal link.'] = () => ({
      paragraphIndex: 0,
      paragraphHtml: `<p>${LONG} Mira <a href="https://t.es/t/">cómo limpiar figuras</a>.</p>`,
      anchorText: 'cómo limpiar figuras',
    });
    failUpdate = true;
    expect((await run('backlink', t.id)).meta).toMatchObject({ linked: [], rejected: [src.id] });
    expect((await prisma.article.findUniqueOrThrow({ where: { id: src.id } })).contentHtml).toBe(
      `<p>${LONG}</p>`,
    );
  });
});
