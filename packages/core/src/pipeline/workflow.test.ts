import { randomBytes } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetDatabase, setupTestDatabase } from '@seo/db/testing';
import type { PrismaClient } from '@seo/db';
import { DEFAULT_SETTINGS } from '@seo/shared';
import type { CreatePostInput, PublishingAdapter } from '../adapters/index.js';
import type { ClaudeClient } from '../ai/claude.js';
import { encryptJson } from '../crypto.js';
import type { EnqueueInput, JobDispatcher, PipelineJobType } from '../queue.js';
import {
  getCalendar,
  publishArticle,
  refreshArticle,
  restorePreviousVersion,
  reviewArticle,
} from '../services/articles.js';
import type { CoreDeps } from '../services/deps.js';
import {
  acceptInvitation,
  getInvitation,
  inviteMember,
  listMembers,
  removeMember,
  updateBranding,
} from '../services/organization.js';
import { getMonthlyReport } from '../services/report.js';
import { updateSite } from '../services/sites.js';
import type { PipelineContext } from './context.js';
import { runPipelineJob } from './index.js';
import { runScheduler } from './scheduler.js';

const db = await setupTestDatabase('core_workflow');
const log = { info: () => undefined, warn: () => undefined, error: () => undefined };
const BODY =
  '<h2>Uno</h2><p>' +
  'texto '.repeat(250) +
  '<a href="https://t.es/old">antiguo</a></p>\n[products ids="7" columns="1"]\n';

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

describe.skipIf(!db)('flujo editorial y organización', () => {
  const prisma = db?.prisma as PrismaClient;
  const key = randomBytes(32);
  let dispatcher: FakeDispatcher;
  let orgId: string;
  let ownerId: string;
  let siteId: string;
  let created: CreatePostInput[];
  let updated: { id: number; input: Partial<CreatePostInput> }[];
  let claudeUser = '';

  const claude = {
    callTool: vi.fn(async (input: { toolDescription: string; user: string }) => {
      claudeUser = input.user;
      return {
        data:
          input.toolDescription === 'Submit the refreshed article body.'
            ? {
                contentHtml:
                  '<h2>Uno actualizado</h2><p>' +
                  'nuevo '.repeat(300) +
                  '<a href="https://t.es/old">antiguo</a> <a href="https://inventada.com">x</a></p>\n[products ids="7" columns="1"]\n<h2>Preguntas frecuentes</h2><h3>¿Sirve?</h3><p>Sí, mucho.</p>',
                changes: ['Actualizada la sección uno'],
              }
            : undefined,
        usage: { inputTokens: 100, outputTokens: 50 },
        model: 'claude-sonnet-5',
      };
    }),
  } as unknown as ClaudeClient;

  const adapter = {
    listContent: async () => [],
    createPost: async (input: CreatePostInput) => {
      created.push(input);
      return { id: 900, url: 'https://t.es/nuevo/', warnings: [] };
    },
    updatePost: async (id: number, input: Partial<CreatePostInput>) => {
      updated.push({ id, input });
      return { warnings: [] };
    },
  } as unknown as PublishingAdapter;

  const fetchFn = (async (u: string | URL | Request, init?: RequestInit) => {
    const url = String(u);
    if (url.includes('oauth2.googleapis.com/token'))
      return new Response(JSON.stringify({ access_token: 'at' }));
    if (url.includes('searchAnalytics')) {
      const body = JSON.parse(String(init?.body));
      expect(body.dimensionFilterGroups[0].filters[0]).toEqual({
        dimension: 'page',
        operator: 'equals',
        expression: 'https://t.es/guia/',
      });
      return new Response(
        JSON.stringify({
          rows: [
            {
              keys: ['cuanto dura una figura'],
              clicks: 2,
              impressions: 140,
              ctr: 0,
              position: 9.4,
            },
          ],
        }),
      );
    }
    return new Response('{}', { status: 404 });
  }) as typeof fetch;

  const ctx = (): PipelineContext => ({
    prisma,
    claude,
    dispatcher,
    encryptionKey: key,
    config: {
      defaultModel: 'm',
      freePlanMaxArticles: 3,
      allowPrivateHosts: true,
      google: { clientId: 'c', clientSecret: 's', redirectUri: '' },
    },
    log,
    fetchFn,
    adapterFactory: () => adapter,
  });
  const deps = (): CoreDeps => ({
    prisma,
    dispatcher,
    encryptionKey: key,
    config: { allowPrivateHosts: true, freePlanMaxArticles: 3 },
  });

  async function drain(): Promise<void> {
    while (dispatcher.queue.length) {
      const job = dispatcher.queue.shift()!;
      await runPipelineJob(ctx(), job.type, {
        jobRunId: job.jobRunId,
        siteId: job.input.siteId,
        refId: job.input.refId,
        attempt: 1,
        maxAttempts: 3,
      });
    }
  }

  beforeEach(async () => {
    await resetDatabase(prisma);
    dispatcher = new FakeDispatcher(prisma);
    created = [];
    updated = [];
    const org = await prisma.organization.create({
      data: {
        name: 'Agencia',
        plan: 'agency',
        users: { create: { email: 'owner@a.es', passwordHash: 'x', role: 'owner' } },
      },
      include: { users: true },
    });
    orgId = org.id;
    ownerId = org.users[0]!.id;
    siteId = (
      await prisma.site.create({
        data: {
          organizationId: orgId,
          name: 'Tienda',
          url: 'https://t.es',
          credentials: 'x',
          settings: DEFAULT_SETTINGS,
        },
      })
    ).id;
  });
  afterAll(async () => prisma.$disconnect());

  it('refresco: usa las consultas reales de la página, conserva enlaces y tarjetas, guarda la versión anterior y republica', async () => {
    await prisma.searchConsoleConnection.create({
      data: {
        siteId,
        credentials: encryptJson(key, { refreshToken: 'rt' }),
        propertyUrl: 'sc-domain:t.es',
      },
    });
    const kw = await prisma.keyword.create({
      data: { siteId, term: 'figuras de resina', status: 'done' },
    });
    const a = await prisma.article.create({
      data: {
        siteId,
        keywordId: kw.id,
        title: 'Guía',
        slug: 'guia',
        status: 'published',
        contentHtml: BODY,
        wordCount: 250,
        remotePostId: 55,
        remoteUrl: 'https://t.es/guia/',
        remoteStatus: 'publish',
        decayDetectedAt: new Date(),
      },
    });
    await refreshArticle(deps(), orgId, a.id);
    await drain();

    expect(claudeUser).toContain('"cuanto dura una figura": 140 impressions');
    const after = await prisma.article.findUniqueOrThrow({ where: { id: a.id } });
    expect(after.previousContentHtml).toBe(BODY);
    expect(after.contentHtml).toContain('Uno actualizado');
    expect(after.contentHtml).toContain('<a href="https://t.es/old">antiguo</a>');
    expect(after.contentHtml).not.toContain('inventada.com');
    expect(after.contentHtml).toContain('[products ids="7" columns="1"]');
    expect(after).toMatchObject({ decayDetectedAt: null, status: 'published' });
    expect(after.refreshedAt).not.toBeNull();
    // Se republica sin pasarlo a borrador (ya estaba publicado en WordPress).
    expect(updated).toEqual([
      expect.objectContaining({ id: 55, input: expect.objectContaining({ status: 'publish' }) }),
    ]);

    const restored = await restorePreviousVersion(deps(), orgId, a.id);
    expect(restored.contentHtml).toBe(BODY);
    expect(restored.previousContentHtml).toContain('Uno actualizado');
  });

  it('refresco solo en planes que lo incluyen', async () => {
    await prisma.organization.update({ where: { id: orgId }, data: { plan: 'starter' } });
    const a = await prisma.article.create({
      data: { siteId, title: 'G', slug: 'g', status: 'ready', contentHtml: BODY },
    });
    await expect(refreshArticle(deps(), orgId, a.id)).rejects.toMatchObject({
      code: 'PLAN_FEATURE_REQUIRED',
    });
    await expect(
      updateSite(deps(), orgId, siteId, { settings: { autoRefresh: true } }),
    ).rejects.toMatchObject({ code: 'PLAN_FEATURE_REQUIRED' });
    await expect(
      updateSite(deps(), orgId, siteId, { settings: { requireApproval: true } }),
    ).rejects.toMatchObject({ code: 'PLAN_FEATURE_REQUIRED' });
  });

  it('aprobación: sin visto bueno no se publica; al aprobar con publicación automática sale a WordPress', async () => {
    await updateSite(deps(), orgId, siteId, {
      settings: { requireApproval: true, autoPublish: true },
    });
    const a = await prisma.article.create({
      data: {
        siteId,
        title: 'G',
        slug: 'g',
        status: 'ready',
        contentHtml: BODY,
        reviewStatus: 'pending',
      },
    });
    await expect(publishArticle(deps(), orgId, a.id)).rejects.toMatchObject({
      code: 'APPROVAL_REQUIRED',
    });

    await reviewArticle(deps(), orgId, ownerId, a.id, {
      decision: 'request_changes',
      comment: 'Más ejemplos',
    });
    expect((await prisma.article.findUniqueOrThrow({ where: { id: a.id } })).reviewStatus).toBe(
      'changes_requested',
    );
    expect(dispatcher.queue).toHaveLength(0);

    await reviewArticle(deps(), orgId, ownerId, a.id, { decision: 'approve' });
    expect(dispatcher.queue.map((q) => q.type)).toEqual(['publish']);
    await drain();
    expect(created[0]).toMatchObject({ status: 'publish' });
    expect(await prisma.articleComment.count({ where: { articleId: a.id } })).toBe(2);
  });

  it('publicación programada: el planificador publica lo que vence (y lo aprobado si hace falta)', async () => {
    const past = new Date(Date.now() - 60_000);
    const future = new Date(Date.now() + 86_400_000);
    const due = await prisma.article.create({
      data: {
        siteId,
        title: 'Vence',
        slug: 'v',
        status: 'ready',
        contentHtml: BODY,
        scheduledFor: past,
      },
    });
    await prisma.article.create({
      data: {
        siteId,
        title: 'Futuro',
        slug: 'f',
        status: 'ready',
        contentHtml: BODY,
        scheduledFor: future,
      },
    });
    const r = await runScheduler(ctx());
    expect(r.scheduled).toBe(1);
    expect((await prisma.article.findUniqueOrThrow({ where: { id: due.id } })).status).toBe(
      'publishing',
    );
    expect((await runScheduler(ctx())).scheduled).toBe(0); // no se repite
    await drain();
    expect(created[0]).toMatchObject({ status: 'publish' }); // programado → publicado aunque no haya autoPublish

    // Con aprobación obligatoria, lo programado espera al visto bueno.
    await prisma.site.update({
      where: { id: siteId },
      data: { settings: { ...DEFAULT_SETTINGS, requireApproval: true } },
    });
    await prisma.article.create({
      data: {
        siteId,
        title: 'Sin OK',
        slug: 's',
        status: 'ready',
        contentHtml: BODY,
        scheduledFor: past,
        reviewStatus: 'pending',
      },
    });
    expect((await runScheduler(ctx())).scheduled).toBe(0);

    const cal = await getCalendar(
      deps(),
      orgId,
      siteId,
      new Date(Date.now() - 7 * 86_400_000),
      new Date(Date.now() + 7 * 86_400_000),
    );
    expect(cal.items.map((i) => i.title).sort()).toEqual(['Futuro', 'Sin OK', 'Vence']);
  });

  it('invitaciones: enlace de un solo uso, límite de miembros y alta en la organización', async () => {
    const link = await inviteMember(
      deps(),
      orgId,
      ownerId,
      { email: 'cliente@c.es', role: 'viewer' },
      'https://app.test/',
    );
    const token = link.url.split('/invite/')[1]!;
    expect(link.url).toMatch(/^https:\/\/app\.test\/invite\//);
    expect(await prisma.invitation.findFirst({ where: { tokenHash: token } })).toBeNull(); // solo el hash
    expect(await getInvitation(deps(), token)).toEqual({
      organizationName: 'Agencia',
      email: 'cliente@c.es',
      role: 'viewer',
    });

    const user = await acceptInvitation(deps(), { token, password: 'contraseña-larga' });
    expect(await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).toMatchObject({
      organizationId: orgId,
      role: 'viewer',
    });
    await expect(
      acceptInvitation(deps(), { token, password: 'contraseña-larga' }),
    ).rejects.toMatchObject({ code: 'INVITATION_INVALID' });

    const members = await listMembers(deps(), orgId, ownerId);
    expect(members.members.map((m) => m.email)).toEqual(['owner@a.es', 'cliente@c.es']);
    await expect(removeMember(deps(), orgId, user.id, ownerId)).rejects.toMatchObject({
      code: 'OWNER_REQUIRED',
    });
    await removeMember(deps(), orgId, ownerId, user.id);
    expect(await prisma.user.count({ where: { organizationId: orgId } })).toBe(1);

    await prisma.organization.update({ where: { id: orgId }, data: { plan: 'starter' } }); // 2 miembros
    await inviteMember(
      deps(),
      orgId,
      ownerId,
      { email: 'a@a.es', role: 'member' },
      'https://app.test',
    );
    await expect(
      inviteMember(deps(), orgId, ownerId, { email: 'b@b.es', role: 'member' }, 'https://app.test'),
    ).rejects.toMatchObject({ code: 'MEMBER_LIMIT' });
  });

  it('informe mensual con marca blanca', async () => {
    await updateBranding(deps(), orgId, ownerId, {
      brandName: 'Mi Agencia',
      brandLogoUrl: 'https://a.es/logo.png',
      brandColor: '#112233',
    });
    const a = await prisma.article.create({
      data: {
        siteId,
        title: 'Guía',
        slug: 'g',
        status: 'published',
        publishedAt: new Date('2026-08-10T10:00:00Z'),
        remoteUrl: 'https://t.es/g/',
      },
    });
    await prisma.searchConsoleConnection.create({
      data: { siteId, credentials: 'x', propertyUrl: 'sc-domain:t.es' },
    });
    await prisma.articleMetric.createMany({
      data: [
        {
          siteId,
          articleId: a.id,
          date: new Date('2026-08-12'),
          clicks: 30,
          impressions: 300,
          position: 6,
        },
        {
          siteId,
          articleId: a.id,
          date: new Date('2026-07-12'),
          clicks: 10,
          impressions: 100,
          position: 9,
        },
      ],
    });
    await prisma.articleConversion.create({
      data: {
        siteId,
        articleId: a.id,
        orderId: '1',
        total: 50,
        currency: 'EUR',
        orderedAt: new Date('2026-08-15'),
      },
    });
    const r = await getMonthlyReport(deps(), orgId, siteId, '2026-08');
    expect(r.branding).toMatchObject({ brandName: 'Mi Agencia', whiteLabel: true });
    expect(r.published.map((p) => p.title)).toEqual(['Guía']);
    expect(r.search).toMatchObject({ clicks: 30, previousClicks: 10, position: 6 });
    expect(r.topArticles[0]).toMatchObject({ title: 'Guía', clicks: 30 });
    expect(r.revenue).toEqual({ total: 50, orders: 1, currency: 'EUR' });

    await prisma.organization.update({ where: { id: orgId }, data: { plan: 'pro' } });
    await expect(
      updateBranding(deps(), orgId, ownerId, {
        brandName: 'X',
        brandLogoUrl: null,
        brandColor: null,
      }),
    ).rejects.toMatchObject({ code: 'PLAN_FEATURE_REQUIRED' });
  });
});
