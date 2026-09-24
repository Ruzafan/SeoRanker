import type { PrismaClient } from '@seo/db';
import type { PublishingAdapter } from '../adapters/index.js';
import type { ClaudeClient } from '../ai/claude.js';
import type { JobDispatcher } from '../queue.js';

export interface Logger {
  info(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
}

export interface PipelineConfig {
  defaultModel: string;
  serpApiKey?: string | undefined;
  /** Tope mensual de artículos del plan free. */
  freePlanMaxArticles: number;
  allowPrivateHosts: boolean;
}

export interface PipelineContext {
  prisma: PrismaClient;
  claude: ClaudeClient;
  dispatcher: JobDispatcher;
  encryptionKey: Buffer;
  config: PipelineConfig;
  log: Logger;
  fetchFn?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  /** Para tests: sustituye la construcción del adapter a partir de las credenciales del sitio. */
  adapterFactory?: (site: { url: string; credentials: string }) => PublishingAdapter;
}

/** Datos mínimos que necesita el pipeline y que no dependen de Fastify ni de BullMQ. */
export interface RunInfo {
  jobRunId: string;
  siteId: string;
  refId?: string | undefined;
  chain?: 'ready' | 'publish' | undefined;
  attempt: number;
  maxAttempts: number;
}
