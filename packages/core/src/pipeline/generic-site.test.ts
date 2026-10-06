import { randomBytes } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetDatabase, setupTestDatabase } from '@seo/db/testing';
import type { PrismaClient } from '@seo/db';
import { clearCrawlerCache } from '../adapters/crawler.js';
import type { ClaudeClient } from '../ai/claude.js';
import type { EnqueueInput, JobDispatcher, PipelineJobType } from '../queue.js';
import { markArticlePublished, publishArticle, reviewArticle } from '../services/articles.js';
import type { CoreDeps } from '../services/deps.js';
import { createSite, listSiteAuthors, testSiteConnection, updateSite } from '../services/sites.js';
import type { PipelineContext } from './context.js';
import { runPipelineJob } from './index.js';
import { runScheduler } from './scheduler.js';

const db = await setupTestDatabase('core_generic_site');
const log = { info: () => undefined, warn: () => undefined, error: () => undefined };
const TEXT = 'Tratamientos dentales con tecnología digital y atención cercana. '.repeat(4);
const html = (title: string) =>
  `<html><head><title>${title} | Clínica</title></head><body><main><h1>${title}</h1><p>${TEXT}</p></main></body></html>`;

const pages: Record<string, string> = {
  'https://clinica.test/': html('Clínica dental Sol'),
  'https://clinica.test/sitemap.xml':
    '<urlset><url><loc>https://clinica.test/blog/blanqueamiento/</loc></url></urlset>',
  'https://clinica.test/blog/blanqueamiento/': html('Blanqueamiento dental'),
};
const fetchFn = (async (u: string | URL | Request) => {
  const body = pages[String(u)];
  return body
    ? new Response(body, { headers: { 'content-type': 'text/html' } })
    : new Response('', { status: 404 });
}) as typeof fetch;

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

describe.skipIf(!db)('web genérica (solo análisis)', () => {
  const prisma = db?.prisma as PrismaClient;
  const key = randomBytes(32);
  let dispatcher: FakeDispatcher;
  let orgId: string;
  let userId: string;

  const claude = {
    callTool: vi.fn(async () => ({
      data: { profile: 'Tono cercano y profesional.' },
      usage: { inputTokens: 10, outputTokens: 5 },
      model: 'm',
    })),
  } as unknown as ClaudeClient;

  const deps = (): CoreDeps => ({
    prisma,
    dispatcher,
    encryptionKey: key,
    config: { allowPrivateHosts: true, freePlanMaxArticles: 3 },
    fetchFn,
  });
  const ctx = (): PipelineContext => ({
    prisma,
    claude,
    dispatcher,
    encryptionKey: key,
    config: { defaultModel: 'm', freePlanMaxArticles: 3, allowPrivateHosts: true },
    log,
    fetchFn,
  });

  const newSite = () =>
    createSite(deps(), orgId, {
      name: 'Clínica',
      url: 'https://clinica.test',
      language: 'es',
      country: 'ES',
      platform: 'generic',
    });

  beforeEach(async () => {
    await resetDatabase(prisma);
    clearCrawlerCache();
    dispatcher = new FakeDispatcher(prisma);
    const org = await prisma.organization.create({
      data: {
        name: 'Agencia',
        plan: 'agency',
        users: { create: { email: 'o@a.es', passwordHash: 'x', role: 'owner' } },
      },
      include: { users: true },
    });
    orgId = org.id;
    userId = org.users[0]!.id;
  });
  afterAll(async () => prisma.$disconnect());

  it('se da de alta sin credenciales y analiza la web rastreándola', async () => {
    const site = await newSite();
    expect(site.credentials).toBe('');
    expect(dispatcher.queue.map((j) => j.type)).toEqual(['brand-voice', 'discover']);

    const job = dispatcher.queue[0]!;
    await runPipelineJob(ctx(), 'brand-voice', {
      jobRunId: job.jobRunId,
      siteId: site.id,
      attempt: 1,
      maxAttempts: 1,
    });
    const after = await prisma.site.findUniqueOrThrow({ where: { id: site.id } });
    expect(after.brandVoice).toBe('Tono cercano y profesional.');

    expect(await testSiteConnection(deps(), orgId, site.id)).toMatchObject({ ok: true });
    expect(await listSiteAuthors(deps(), orgId, site.id)).toEqual([]);
    await expect(
      updateSite(deps(), orgId, site.id, { wpUsername: 'u', wpAppPassword: '12345678' }),
    ).rejects.toMatchObject({ code: 'PLATFORM_NOT_SUPPORTED' });
  });

  it('no publica: el artículo se marca publicado con la URL donde se copió', async () => {
    const site = await newSite();
    const article = await prisma.article.create({
      data: {
        siteId: site.id,
        title: 'Blanqueamiento',
        slug: 'blanqueamiento',
        status: 'ready',
        contentHtml: '<p>hola</p>',
      },
    });
    await expect(publishArticle(deps(), orgId, article.id)).rejects.toMatchObject({
      code: 'PLATFORM_NOT_SUPPORTED',
    });
    await expect(
      markArticlePublished(deps(), orgId, article.id, { url: 'https://otra.test/x' }),
    ).rejects.toMatchObject({ code: 'INVALID_URL' });

    const done = await markArticlePublished(deps(), orgId, article.id, {
      url: 'www.clinica.test/blog/blanqueamiento/#top',
    });
    expect(done).toMatchObject({
      status: 'published',
      remoteUrl: 'https://www.clinica.test/blog/blanqueamiento/',
      remotePostId: null,
    });
    expect(done.publishedAt).toBeInstanceOf(Date);
  });

  it('aprobar con autoPublish no envía a publicar y la cadencia deja los artículos listos', async () => {
    const site = await newSite();
    await prisma.site.update({
      where: { id: site.id },
      data: { settings: { cadence: 'daily', autoPublish: true, onboarding: 'done' } },
    });
    dispatcher.queue = [];
    const article = await prisma.article.create({
      data: {
        siteId: site.id,
        title: 'A',
        slug: 'a',
        status: 'ready',
        contentHtml: '<p>x</p>',
        scheduledFor: new Date(Date.now() - 1000),
      },
    });
    await reviewArticle(deps(), orgId, userId, article.id, { decision: 'approve' });
    await prisma.keyword.create({ data: { siteId: site.id, term: 'blanqueamiento dental' } });

    await runScheduler(ctx());
    expect(dispatcher.queue.map((j) => [j.type, j.input.chain])).toEqual([['outline', 'ready']]);
    const still = await prisma.article.findUniqueOrThrow({ where: { id: article.id } });
    expect(still.status).toBe('ready');
  });
});
