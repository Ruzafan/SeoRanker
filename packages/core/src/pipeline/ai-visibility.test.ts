import { randomBytes } from 'node:crypto';
import type Anthropic from '@anthropic-ai/sdk';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetDatabase, setupTestDatabase } from '@seo/db/testing';
import type { PrismaClient } from '@seo/db';
import { DEFAULT_SETTINGS } from '@seo/shared';
import { answerWithSearch, type ClaudeClient, type MessagesApi } from '../ai/claude.js';
import type { EnqueueInput, JobDispatcher, PipelineJobType } from '../queue.js';
import { getAiVisibility, runAiVisibilityNow } from '../services/ai-visibility.js';
import { buyerQuestions, mentions } from './ai-visibility.js';
import type { PipelineContext } from './context.js';
import { runPipelineJob } from './index.js';

describe('visibilidad en IA: utilidades', () => {
  it('preguntas de comprador: comerciales primero, en el idioma del sitio', () => {
    const q = buyerQuestions(
      [
        { term: 'limpiar figuras', intent: 'informational' },
        { term: 'vitrinas led', intent: 'commercial' },
      ],
      'es',
    );
    expect(q).toEqual([
      '¿Dónde puedo comprar vitrinas led online?',
      'Limpiar figuras: ¿qué me recomiendas y dónde lo encuentro?',
    ]);
    expect(buyerQuestions([{ term: 'led cabinets', intent: 'commercial' }], 'xx')).toEqual([
      'Where can I buy led cabinets online?',
    ]);
  });

  it('mención por nombre (sin acentos ni mayúsculas) o por dominio', () => {
    const site = { name: 'Figuras Pérez', url: 'https://www.figuras-perez.es' };
    expect(mentions('Te recomiendo FIGURAS PEREZ por su catálogo', site)).toBe(true);
    expect(mentions('Mira figuras-perez.es', site)).toBe(true);
    expect(mentions('Prueba Amazon o Fnac', site)).toBe(false);
  });

  it('answerWithSearch: continúa tras pause_turn y junta texto, fuentes, citas y búsquedas', async () => {
    const usage = (searches: number) =>
      ({
        input_tokens: 100,
        output_tokens: 50,
        server_tool_use: { web_search_requests: searches },
      }) as never;
    const create = vi
      .fn()
      .mockResolvedValueOnce({
        model: 'claude-sonnet-5',
        stop_reason: 'pause_turn',
        usage: usage(1),
        content: [
          { type: 'server_tool_use', id: 's1', name: 'web_search', input: { query: 'x' } },
          {
            type: 'web_search_tool_result',
            tool_use_id: 's1',
            content: [
              {
                type: 'web_search_result',
                url: 'https://rival.es/a',
                title: 'Rival',
                encrypted_content: '',
                page_age: null,
              },
            ],
          },
        ],
      })
      .mockResolvedValueOnce({
        model: 'claude-sonnet-5',
        stop_reason: 'end_turn',
        usage: usage(1),
        content: [
          {
            type: 'text',
            text: 'Te recomiendo Rival.',
            citations: [
              {
                type: 'web_search_result_location',
                url: 'https://rival.es/a',
                title: 'Rival',
                cited_text: 'x',
                encrypted_index: '',
              },
            ],
          },
        ],
      });
    const api = { messages: { create } } as unknown as MessagesApi;
    const r = await answerWithSearch(api, {
      model: 'claude-sonnet-5',
      system: 's',
      user: 'u',
      maxTokens: 500,
      maxSearches: 3,
      country: 'ES',
    });
    expect(r).toMatchObject({
      text: 'Te recomiendo Rival.',
      sources: [{ url: 'https://rival.es/a', title: 'Rival' }],
      citedUrls: ['https://rival.es/a'],
      searches: 2,
      usage: { inputTokens: 200, outputTokens: 100 },
    });
    const first = create.mock.calls[0]?.[0] as Anthropic.MessageCreateParamsNonStreaming;
    expect(first.tools?.[0]).toMatchObject({
      type: 'web_search_20250305',
      max_uses: 3,
      user_location: { country: 'ES' },
    });
    // La continuación reenvía lo recibido como turno del asistente.
    const second = create.mock.calls[1]?.[0] as Anthropic.MessageCreateParamsNonStreaming;
    expect(second.messages.at(-1)?.role).toBe('assistant');
  });
});

const db = await setupTestDatabase('core_aivis');
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

describe.skipIf(!db)('visibilidad en IA (integración)', () => {
  const prisma = db?.prisma as PrismaClient;
  let dispatcher: FakeDispatcher;
  let orgId: string;
  let siteId: string;
  const claude = {
    searchAnswer: vi.fn(async (input: { user: string }) => ({
      text: input.user.includes('vitrinas')
        ? 'Te recomiendo Figuras Top y rival.es'
        : 'Prueba en amazon.es',
      sources: [],
      citedUrls: input.user.includes('vitrinas')
        ? ['https://figurastop.es/vitrinas', 'https://rival.es/x']
        : ['https://www.amazon.es/y'],
      searches: 2,
      usage: { inputTokens: 1000, outputTokens: 300 },
      model: 'claude-sonnet-5',
    })),
  } as unknown as ClaudeClient;

  const deps = () => ({
    prisma,
    dispatcher,
    encryptionKey: randomBytes(32),
    config: { allowPrivateHosts: true, freePlanMaxArticles: 3 },
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    dispatcher = new FakeDispatcher(prisma);
    orgId = (await prisma.organization.create({ data: { name: 'O', plan: 'pro' } })).id;
    siteId = (
      await prisma.site.create({
        data: {
          organizationId: orgId,
          name: 'Figuras Top',
          url: 'https://figurastop.es',
          credentials: 'x',
          settings: DEFAULT_SETTINGS,
        },
      })
    ).id;
    await prisma.keyword.createMany({
      data: [
        { siteId, term: 'vitrinas led', intent: 'commercial', score: 90 },
        { siteId, term: 'limpiar figuras', intent: 'informational', score: 80 },
      ],
    });
  });
  afterAll(async () => prisma.$disconnect());

  it('pregunta, detecta mención/cita/competencia, suma el coste de las búsquedas y resume', async () => {
    const { jobRunId } = await runAiVisibilityNow(deps(), orgId, siteId);
    const job = dispatcher.queue.shift()!;
    const ctx: PipelineContext = {
      prisma,
      claude,
      dispatcher,
      encryptionKey: randomBytes(32),
      config: { defaultModel: 'claude-sonnet-5', freePlanMaxArticles: 3, allowPrivateHosts: true },
      log,
    };
    await runPipelineJob(ctx, 'ai-visibility', { jobRunId, siteId, attempt: 1, maxAttempts: 3 });
    expect(job.jobRunId).toBe(jobRunId);

    const run = await prisma.jobRun.findUniqueOrThrow({ where: { id: jobRunId } });
    expect(run.meta).toMatchObject({ questions: 2, mentioned: 1 });
    const usage = await prisma.usageRecord.findFirstOrThrow({ where: { siteId } });
    expect(usage.articles).toBe(0); // no cuenta como artículo
    expect(usage.costCents).toBeGreaterThanOrEqual(4); // 4 búsquedas a 1 céntimo + tokens

    const v = await getAiVisibility(deps(), orgId, siteId);
    expect(v).toMatchObject({ enabled: true, mentionRate: 0.5 });
    expect(v.checks).toEqual([
      {
        prompt: '¿Dónde puedo comprar vitrinas led online?',
        mentioned: true,
        cited: true,
        competitors: ['rival.es'],
      },
      {
        prompt: 'Limpiar figuras: ¿qué me recomiendas y dónde lo encuentro?',
        mentioned: false,
        cited: false,
        competitors: ['amazon.es'],
      },
    ]);
    expect(v.topCompetitors.map((c) => c.domain).sort()).toEqual(['amazon.es', 'rival.es']);
    expect(v.history).toHaveLength(1);
  });

  it('solo en planes con visibilidad en IA', async () => {
    await prisma.organization.update({ where: { id: orgId }, data: { plan: 'starter' } });
    await expect(runAiVisibilityNow(deps(), orgId, siteId)).rejects.toMatchObject({
      code: 'PLAN_FEATURE_REQUIRED',
    });
    expect((await getAiVisibility(deps(), orgId, siteId)).enabled).toBe(false);
  });
});
