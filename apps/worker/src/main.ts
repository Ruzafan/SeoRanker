import { UnrecoverableError, Worker, type Job } from 'bullmq';
import { pino } from 'pino';
import {
  BullDispatcher,
  ClaudeClient,
  QUEUE_NAMES,
  createQueues,
  errorMessage,
  isRetryable,
  parseEncryptionKey,
  redisConnectionFromUrl,
  runPipelineJob,
  runScheduler,
  runSyncScheduler,
  runWatchdog,
  type JobPayload,
  type PipelineContext,
  type PipelineJobType,
} from '@seo/core';
import { getPrisma } from '@seo/db';
import { loadEnv } from './env.js';

const REDACT = ['*.password', '*.credentials', '*.apiKey', '*.authorization', '*.appPassword'];
const PIPELINE_TYPES: PipelineJobType[] = [
  'brand-voice',
  'discover',
  'outline',
  'write',
  'publish',
  'sync',
  'cluster',
  'backlink',
];
const WATCHDOG_EVERY_MS = 10 * 60_000;
const SCHEDULER_EVERY_MS = 15 * 60_000;
const SYNC_SCHEDULER_EVERY_MS = 60 * 60_000;

async function main(): Promise<void> {
  const env = loadEnv();
  const log = pino({ level: env.LOG_LEVEL, redact: { paths: REDACT, censor: '[REDACTED]' } });

  const prisma = getPrisma();
  await prisma.$queryRaw`SELECT 1`;

  const connection = redisConnectionFromUrl(env.REDIS_URL);
  const queues = createQueues(connection);
  for (const q of Object.values(queues))
    q.on('error', (err) => log.error({ err: errorMessage(err) }, 'queue error'));

  const ctx: PipelineContext = {
    prisma,
    claude: new ClaudeClient(env.ANTHROPIC_API_KEY),
    dispatcher: new BullDispatcher(prisma, queues),
    encryptionKey: parseEncryptionKey(env.ENCRYPTION_KEY),
    config: {
      defaultModel: env.DEFAULT_MODEL,
      serpApiKey: env.SERPAPI_KEY,
      freePlanMaxArticles: env.FREE_PLAN_MAX_ARTICLES,
      allowPrivateHosts: env.ALLOW_PRIVATE_HOSTS,
      google:
        env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
          ? {
              clientId: env.GOOGLE_CLIENT_ID,
              clientSecret: env.GOOGLE_CLIENT_SECRET,
              redirectUri: '', // el worker solo refresca tokens
            }
          : undefined,
      dataForSeo:
        env.DATAFORSEO_LOGIN && env.DATAFORSEO_PASSWORD
          ? { login: env.DATAFORSEO_LOGIN, password: env.DATAFORSEO_PASSWORD }
          : undefined,
    },
    log: {
      info: (o, m) => log.info(o, m),
      warn: (o, m) => log.warn(o, m),
      error: (o, m) => log.error(o, m),
    },
  };

  const processor = (type: PipelineJobType) => async (job: Job<JobPayload>) => {
    const { jobRunId, siteId, refId, chain } = job.data;
    // El sitio (y con él sus JobRun) pudo borrarse mientras el trabajo esperaba en cola.
    if (!(await prisma.jobRun.findUnique({ where: { id: jobRunId }, select: { id: true } }))) {
      log.warn({ jobRunId, type }, 'job run no longer exists, dropping job');
      return;
    }
    try {
      await runPipelineJob(ctx, type, {
        jobRunId,
        siteId,
        refId,
        chain,
        attempt: job.attemptsMade + 1,
        maxAttempts: job.opts.attempts ?? 3,
      });
    } catch (err) {
      // Los errores no reintentables (400 de la API, rate limit de Autocomplete, truncamiento…) no gastan reintentos.
      if (!isRetryable(err)) throw new UnrecoverableError(errorMessage(err));
      throw err;
    }
  };

  const workers = PIPELINE_TYPES.map((type) => {
    const w = new Worker<JobPayload>(QUEUE_NAMES[type], processor(type), {
      connection,
      concurrency: type === 'write' ? env.WORKER_CONCURRENCY : Math.max(env.WORKER_CONCURRENCY, 2),
    });
    w.on('failed', (job, err) =>
      log.warn(
        { type, jobId: job?.id, attempt: job?.attemptsMade, err: err.message },
        'job attempt failed',
      ),
    );
    w.on('error', (err) => log.error({ type, err: err.message }, 'worker error'));
    return w;
  });

  // Mantenimiento: watchdog de zombis y planificador de cadencias.
  const maintenance = new Worker(
    QUEUE_NAMES.maintenance,
    async (job) => {
      if (job.name === 'watchdog') return runWatchdog(prisma, ctx.log);
      if (job.name === 'scheduler') return runScheduler(ctx);
      if (job.name === 'sync-scheduler') return runSyncScheduler(ctx);
      return undefined;
    },
    { connection, concurrency: 1 },
  );
  maintenance.on('failed', (job, err) =>
    log.error({ job: job?.name, err: err.message }, 'maintenance failed'),
  );
  maintenance.on('error', (err) => log.error({ err: err.message }, 'maintenance worker error'));

  const jobOpts = { removeOnComplete: { count: 20 }, removeOnFail: { count: 50 } };
  await queues.maintenance.upsertJobScheduler(
    'watchdog',
    { every: WATCHDOG_EVERY_MS },
    { name: 'watchdog', opts: jobOpts },
  );
  await queues.maintenance.upsertJobScheduler(
    'scheduler',
    { every: SCHEDULER_EVERY_MS },
    { name: 'scheduler', opts: jobOpts },
  );

  await queues.maintenance.upsertJobScheduler(
    'sync-scheduler',
    { every: SYNC_SCHEDULER_EVERY_MS },
    { name: 'sync-scheduler', opts: jobOpts },
  );

  log.info(
    { queues: [...PIPELINE_TYPES, 'maintenance'], model: env.DEFAULT_MODEL },
    'worker ready',
  );

  const shutdown = async (signal: string): Promise<void> => {
    log.info({ signal }, 'shutting down');
    await Promise.all([...workers, maintenance].map((w) => w.close()));
    await Promise.all(Object.values(queues).map((q) => q.close()));
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
