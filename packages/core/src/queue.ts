import { Queue, type ConnectionOptions } from 'bullmq';
import type { PrismaClient } from '@seo/db';
import { AppError, errorMessage } from './errors.js';

export const QUEUE_NAMES = {
  'brand-voice': 'brand-voice',
  discover: 'discover',
  outline: 'outline',
  write: 'write',
  publish: 'publish',
  maintenance: 'maintenance',
} as const;

export type PipelineJobType = 'brand-voice' | 'discover' | 'outline' | 'write' | 'publish';

export interface JobPayload {
  jobRunId: string;
  siteId: string;
  refId?: string | undefined;
  /** 'ready': parar al terminar el artículo. 'publish': seguir hasta WordPress (automatización). */
  chain?: 'ready' | 'publish' | undefined;
}

export interface EnqueueInput {
  siteId: string;
  refId?: string | undefined;
  chain?: 'ready' | 'publish' | undefined;
}

export interface JobDispatcher {
  enqueue(type: PipelineJobType, input: EnqueueInput): Promise<{ jobRunId: string }>;
}

export const DEFAULT_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 30_000 },
  removeOnComplete: { age: 24 * 3600, count: 1000 },
  removeOnFail: { age: 7 * 24 * 3600 },
} as const;

/** BullMQ acepta opciones de conexión; parsear la URL evita choques de versiones de ioredis. */
export function redisConnectionFromUrl(redisUrl: string): ConnectionOptions {
  const u = new URL(redisUrl);
  const db = u.pathname.length > 1 ? Number(u.pathname.slice(1)) : undefined;
  return {
    host: u.hostname,
    port: u.port ? Number(u.port) : 6379,
    username: u.username ? decodeURIComponent(u.username) : undefined,
    password: u.password ? decodeURIComponent(u.password) : undefined,
    db: Number.isFinite(db) ? db : undefined,
    tls: u.protocol === 'rediss:' ? {} : undefined,
    maxRetriesPerRequest: null,
  };
}

export function createQueues(
  connection: ConnectionOptions,
): Record<keyof typeof QUEUE_NAMES, Queue> {
  const make = (name: string) =>
    new Queue(name, { connection, defaultJobOptions: DEFAULT_JOB_OPTIONS });
  return {
    'brand-voice': make(QUEUE_NAMES['brand-voice']),
    discover: make(QUEUE_NAMES.discover),
    outline: make(QUEUE_NAMES.outline),
    write: make(QUEUE_NAMES.write),
    publish: make(QUEUE_NAMES.publish),
    maintenance: make(QUEUE_NAMES.maintenance),
  };
}

/** Crea el JobRun en estado `queued` y encola en BullMQ. Si encolar falla, el JobRun queda `failed`. */
export class BullDispatcher implements JobDispatcher {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly queues: Record<keyof typeof QUEUE_NAMES, Queue>,
  ) {}

  async enqueue(type: PipelineJobType, input: EnqueueInput): Promise<{ jobRunId: string }> {
    const run = await this.prisma.jobRun.create({
      data: { siteId: input.siteId, type, status: 'queued', refId: input.refId ?? null },
    });
    const payload: JobPayload = {
      jobRunId: run.id,
      siteId: input.siteId,
      refId: input.refId,
      chain: input.chain,
    };
    try {
      await this.queues[type].add(type, payload);
    } catch (err) {
      await this.prisma.jobRun.update({
        where: { id: run.id },
        data: {
          status: 'failed',
          error: `QUEUE_UNAVAILABLE: ${errorMessage(err)}`,
          finishedAt: new Date(),
        },
      });
      throw new AppError('CONNECTION_FAILED', 'Could not enqueue job (Redis unavailable)', {
        httpStatus: 503,
        cause: err,
      });
    }
    return { jobRunId: run.id };
  }
}
