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

function toInputSchema(schema: z.ZodType): Anthropic.Tool.InputSchema {
  const json = z.toJSONSchema(schema, { io: 'input' }) as Record<string, unknown>;
  delete json['$schema'];
  if (json['type'] !== 'object') {
    throw new Error('El schema de un tool debe ser un objeto');
  }
  return json as unknown as Anthropic.Tool.InputSchema;
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

    if (response.stop_reason === 'max_tokens') {
      throw new AppError(
        'AI_TRUNCATED',
        `Model output truncated at max_tokens=${input.maxTokens} (${usage.outputTokens} tokens)`,
        { httpStatus: 502, retryable: false },
      );
    }

    const block = response.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === TOOL_NAME,
    );
    if (!block) {
      throw new AppError('AI_INVALID_OUTPUT', 'Model did not return the expected tool call', {
        httpStatus: 502,
        retryable: true,
      });
    }

    const parsed = input.schema.safeParse(block.input);
    if (!parsed.success) {
      const detail = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      throw new AppError('AI_INVALID_OUTPUT', `Tool output failed validation: ${detail}`, {
        httpStatus: 502,
        retryable: true,
      });
    }
    return { data: parsed.data, usage, model: response.model };
  }
}
