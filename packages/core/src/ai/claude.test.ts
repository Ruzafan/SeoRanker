import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { AppError } from '../errors.js';
import { ClaudeClient, type MessagesApi } from './claude.js';

const schema = z.object({ n: z.number().int(), label: z.string() });

function fakeApi(response: Partial<Anthropic.Message> | Error) {
  const create = vi.fn(async () => {
    if (response instanceof Error) throw response;
    return response as Anthropic.Message;
  });
  return { api: { messages: { create } } as unknown as MessagesApi, create };
}

const base = { model: 'claude-sonnet-5', usage: { input_tokens: 10, output_tokens: 5 } };
const input = { model: 'm', system: 's', user: 'u', maxTokens: 100, toolDescription: 'd', schema };

describe('ClaudeClient.callTool', () => {
  it('fuerza el tool y devuelve datos validados con su uso', async () => {
    const { api, create } = fakeApi({
      ...base,
      stop_reason: 'tool_use',
      content: [{ type: 'tool_use', id: '1', name: 'submit_result', input: { n: 3, label: 'x' } }],
    });
    const res = await new ClaudeClient(undefined, api).callTool(input);
    expect(res.data).toEqual({ n: 3, label: 'x' });
    expect(res.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
    const params = (
      create.mock.calls[0] as unknown as [Anthropic.MessageCreateParamsNonStreaming]
    )[0];
    expect(params.tool_choice).toEqual({ type: 'tool', name: 'submit_result' });
    expect(params.tools?.[0]).toMatchObject({
      name: 'submit_result',
      input_schema: { type: 'object' },
    });
  });

  it('usa strict tool use con un schema compatible (objetos cerrados, sin min/max)', async () => {
    const nested = z.object({
      title: z.string().min(5),
      sections: z
        .array(z.object({ heading: z.string().min(2), points: z.array(z.string()).min(1) }))
        .min(3),
    });
    const { api, create } = fakeApi({
      ...base,
      stop_reason: 'tool_use',
      content: [
        {
          type: 'tool_use',
          id: '1',
          name: 'submit_result',
          input: {
            title: 'Título',
            sections: ['a', 'b', 'c'].map((h) => ({ heading: h + h, points: ['xx'] })),
          },
        },
      ],
    });
    await new ClaudeClient(undefined, api).callTool({ ...input, schema: nested });
    const tool = (create.mock.calls[0] as unknown as [Anthropic.MessageCreateParamsNonStreaming])[0]
      .tools?.[0] as Anthropic.Tool;
    expect(tool.strict).toBe(true);
    const json = JSON.stringify(tool.input_schema);
    expect(json).not.toMatch(/minLength|minItems|maxLength|maxItems/);
    expect(tool.input_schema).toMatchObject({
      additionalProperties: false,
      properties: { sections: { items: { additionalProperties: false } } },
    });
  });

  it('lanza error explícito de truncamiento (no retryable)', async () => {
    const { api } = fakeApi({ ...base, stop_reason: 'max_tokens', content: [] });
    await expect(new ClaudeClient(undefined, api).callTool(input)).rejects.toMatchObject({
      code: 'AI_TRUNCATED',
      retryable: false,
    });
  });

  it('valida el input del tool con zod', async () => {
    const { api } = fakeApi({
      ...base,
      stop_reason: 'tool_use',
      content: [{ type: 'tool_use', id: '1', name: 'submit_result', input: { n: 'no', label: 1 } }],
    });
    await expect(new ClaudeClient(undefined, api).callTool(input)).rejects.toMatchObject({
      code: 'AI_INVALID_OUTPUT',
    });
  });

  it('falla si no hay bloque tool_use', async () => {
    const { api } = fakeApi({
      ...base,
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: '{"n":1}', citations: null }],
    });
    await expect(new ClaudeClient(undefined, api).callTool(input)).rejects.toMatchObject({
      code: 'AI_INVALID_OUTPUT',
    });
  });

  it('429 y 5xx son reintentables; otros 4xx no', async () => {
    const mk = (status: number) => new Anthropic.APIError(status, {}, 'boom', new Headers());
    for (const [status, retryable, code] of [
      [429, true, 'RATE_LIMITED'],
      [503, true, 'AI_ERROR'],
      [400, false, 'AI_ERROR'],
    ] as const) {
      const { api } = fakeApi(mk(status));
      const err = await new ClaudeClient(undefined, api).callTool(input).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(AppError);
      expect(err).toMatchObject({ code, retryable });
    }
  });

  it('sin API key ni cliente inyectado, falla al construir', () => {
    expect(() => new ClaudeClient(undefined)).toThrow(/ANTHROPIC_API_KEY/);
  });
});
