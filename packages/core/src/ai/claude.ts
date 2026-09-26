import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { AppError } from '../errors.js';

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface ToolCallInput<T> {
  model: string;
  system: string;
  user: string;
  maxTokens: number;
  toolDescription: string;
  /** Schema zod: de él se deriva el JSON Schema del tool y con él se valida la respuesta. */
  schema: z.ZodType<T>;
}

export interface ToolCallResult<T> {
  data: T;
  usage: TokenUsage;
  model: string;
}

/** Subconjunto del SDK que usamos; permite inyectar un doble en tests. */
export interface MessagesApi {
  messages: {
    create: (params: Anthropic.MessageCreateParamsNonStreaming) => Promise<Anthropic.Message>;
  };
}

const TOOL_NAME = 'submit_result';

/** Restricciones que strict tool use no admite; zod las sigue validando al recibir la respuesta. */
const UNSUPPORTED_STRICT_KEYWORDS = [
  'minLength',
  'maxLength',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'minItems',
  'maxItems',
  'pattern',
];

/** Adapta el JSON Schema a strict tool use: objetos cerrados y sin restricciones no soportadas. */
function toStrictSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(toStrictSchema);
  if (node === null || typeof node !== 'object') return node;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (UNSUPPORTED_STRICT_KEYWORDS.includes(key)) continue;
    out[key] = key === 'properties' ? mapValues(value, toStrictSchema) : toStrictSchema(value);
  }
  if (out['type'] === 'object') out['additionalProperties'] = false;
  return out;
}

function mapValues(value: unknown, fn: (v: unknown) => unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fn(v)]));
}

function toInputSchema(schema: z.ZodType): Anthropic.Tool.InputSchema {
  const json = z.toJSONSchema(schema, { io: 'input' }) as Record<string, unknown>;
  delete json['$schema'];
  if (json['type'] !== 'object') {
    throw new Error('El schema de un tool debe ser un objeto');
  }
  return toStrictSchema(json) as Anthropic.Tool.InputSchema;
}

/** Traduce errores del SDK: 429/5xx/conexión se reintentan, el resto de 4xx no. */
function mapApiError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  if (err instanceof Anthropic.APIError) {
    const status = err.status;
    if (status === 429) {
      return new AppError('RATE_LIMITED', `Anthropic rate limit (429): ${err.message}`, {
        httpStatus: 429,
        retryable: true,
        cause: err,
      });
    }
    if (status === undefined || status >= 500) {
      return new AppError(
        'AI_ERROR',
        `Anthropic unavailable (${status ?? 'network'}): ${err.message}`,
        {
          httpStatus: 502,
          retryable: true,
          cause: err,
        },
      );
    }
    return new AppError('AI_ERROR', `Anthropic rejected the request (${status}): ${err.message}`, {
      httpStatus: 502,
      retryable: false,
      cause: err,
    });
  }
  return new AppError(
    'AI_ERROR',
    `Anthropic call failed: ${err instanceof Error ? err.message : String(err)}`,
    {
      httpStatus: 502,
      retryable: true,
      cause: err,
    },
  );
}

/** Único módulo que habla con la API de Anthropic. Toda salida estructurada va por tool use. */
export class ClaudeClient {
  private readonly api: MessagesApi;

  constructor(apiKey: string | undefined, api?: MessagesApi) {
    if (api) {
      this.api = api;
    } else {
      if (!apiKey)
        throw new AppError('AI_ERROR', 'ANTHROPIC_API_KEY is not configured', { httpStatus: 500 });
      this.api = new Anthropic({ apiKey });
    }
  }

  /** Respuesta libre con búsqueda web (ver answerWithSearch). */
  searchAnswer(input: SearchAnswerInput): Promise<SearchAnswerResult> {
    return answerWithSearch(this.api, input);
  }

  async callTool<T>(input: ToolCallInput<T>): Promise<ToolCallResult<T>> {
    let response: Anthropic.Message;
    try {
      response = await this.api.messages.create({
        model: input.model,
        max_tokens: input.maxTokens,
        system: input.system,
        messages: [{ role: 'user', content: input.user }],
        tools: [
          {
            name: TOOL_NAME,
            description: input.toolDescription,
            // Sin strict, el modelo a veces devuelve arrays anidados como string JSON.
            strict: true,
            input_schema: toInputSchema(input.schema),
          },
        ],
        tool_choice: { type: 'tool', name: TOOL_NAME },
      });
    } catch (err) {
      throw mapApiError(err);
    }

    const usage: TokenUsage = {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    };

    // Lo gastado se cobra aunque la respuesta no sirva: viaja en el error para registrarlo.
    const spent = { model: response.model, ...usage };
    if (response.stop_reason === 'max_tokens') {
      throw new AppError(
        'AI_TRUNCATED',
        `Model output truncated at max_tokens=${input.maxTokens} (${usage.outputTokens} tokens)`,
        { httpStatus: 502, retryable: false, usage: spent },
      );
    }

    const block = response.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === TOOL_NAME,
    );
    if (!block) {
      throw new AppError('AI_INVALID_OUTPUT', 'Model did not return the expected tool call', {
        httpStatus: 502,
        retryable: true,
        usage: spent,
      });
    }

    const parsed = input.schema.safeParse(block.input);
    if (!parsed.success) {
      const detail = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      throw new AppError('AI_INVALID_OUTPUT', `Tool output failed validation: ${detail}`, {
        httpStatus: 502,
        retryable: true,
        usage: spent,
      });
    }
    return { data: parsed.data, usage, model: response.model };
  }
}

export interface SearchAnswerInput {
  model: string;
  system: string;
  user: string;
  maxTokens: number;
  /** Búsquedas web como máximo en la respuesta. */
  maxSearches: number;
  /** País ISO para localizar los resultados. */
  country?: string;
}

export interface SearchAnswerResult {
  text: string;
  /** Resultados que devolvió la búsqueda web. */
  sources: { url: string; title: string }[];
  /** URL que la respuesta cita expresamente. */
  citedUrls: string[];
  searches: number;
  usage: TokenUsage;
  model: string;
}

const MAX_CONTINUATIONS = 3;

/**
 * Respuesta en texto libre con la herramienta de búsqueda web del servidor (como respondería un
 * asistente a un usuario). Se usa para medir la visibilidad de una marca en asistentes de IA; no es
 * salida estructurada, así que no pasa por callTool.
 */
export async function answerWithSearch(
  api: MessagesApi,
  input: SearchAnswerInput,
): Promise<SearchAnswerResult> {
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: input.user }];
  const usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
  const content: Anthropic.ContentBlock[] = [];
  let searches = 0;
  let model = input.model;
  for (let i = 0; i <= MAX_CONTINUATIONS; i++) {
    let response: Anthropic.Message;
    try {
      response = await api.messages.create({
        model: input.model,
        max_tokens: input.maxTokens,
        system: input.system,
        messages,
        tools: [
          {
            // Variante básica a propósito: la de filtrado dinámico (20260209) mete el contenido de
            // las páginas en el contexto (~6× más tokens y ~6× más lenta, medido) y no devuelve
            // citas, que es justo lo que necesita la medición de visibilidad.
            type: 'web_search_20250305',
            name: 'web_search',
            max_uses: input.maxSearches,
            ...(input.country
              ? { user_location: { type: 'approximate' as const, country: input.country } }
              : {}),
          },
        ],
      });
    } catch (err) {
      throw mapApiError(err);
    }
    usage.inputTokens += response.usage.input_tokens;
    usage.outputTokens += response.usage.output_tokens;
    searches += response.usage.server_tool_use?.web_search_requests ?? 0;
    model = response.model;
    content.push(...response.content);
    // pause_turn: el servidor cortó un turno largo; se continúa reenviando lo recibido.
    if (response.stop_reason !== 'pause_turn') break;
    messages.push({ role: 'assistant', content: response.content });
  }

  const text = content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');
  const sources = content
    .filter((b): b is Anthropic.WebSearchToolResultBlock => b.type === 'web_search_tool_result')
    .flatMap((b) => (Array.isArray(b.content) ? b.content : []))
    .map((r) => ({ url: r.url, title: r.title }));
  const citedUrls = content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .flatMap((b) => b.citations ?? [])
    .filter(
      (c): c is Anthropic.CitationsWebSearchResultLocation =>
        c.type === 'web_search_result_location',
    )
    .map((c) => c.url);
  return { text, sources, citedUrls: [...new Set(citedUrls)], searches, usage, model };
}
