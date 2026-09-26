import { AppError, errorCode, errorMessage } from '../errors.js';
import type { PipelineContext, RunInfo } from './context.js';
import { UsageTracker } from './usage.js';

export interface TrackedResult {
  meta?: Record<string, unknown>;
}

export interface TrackedHooks {
  /** Se llama al fallar. `willRetry` indica si BullMQ volverá a intentarlo. */
  onFailure?: (err: unknown, willRetry: boolean) => Promise<void>;
}

export function isRetryable(err: unknown): boolean {
  // Un error desconocido (red, BD) se trata como transitorio; los AppError declaran su naturaleza.
  return err instanceof AppError ? err.retryable : true;
}

/**
 * Envuelve un trabajo: escribe JobRun al empezar y al acabar (duración, tokens, error)
 * y relanza el error para que BullMQ aplique reintentos/backoff.
 */
export async function runTracked(
  ctx: PipelineContext,
  info: RunInfo,
  fn: (tracker: UsageTracker) => Promise<TrackedResult | void>,
  hooks: TrackedHooks = {},
): Promise<void> {
  const started = Date.now();
  const tracker = new UsageTracker(ctx.prisma, info.siteId);
  await ctx.prisma.jobRun.update({
    where: { id: info.jobRunId },
    data: { status: 'running', attempt: info.attempt, startedAt: new Date(), error: null },
  });

  try {
    const result = await fn(tracker);
    await ctx.prisma.jobRun.update({
      where: { id: info.jobRunId },
      data: {
        status: 'succeeded',
        finishedAt: new Date(),
        error: null,
        meta: {
          ...tracker.toMeta(),
          ...(result?.meta ?? {}),
          durationMs: Date.now() - started,
        } as never,
      },
    });
  } catch (err) {
    const willRetry = isRetryable(err) && info.attempt < info.maxAttempts;
    // Una llamada a Claude que falló tras responder (truncada, salida inválida) también se pagó.
    if (err instanceof AppError && err.usage) {
      const { model, ...tokens } = err.usage;
      await tracker.add(model, tokens).catch(() => undefined);
    }
    const message = `${errorCode(err)}: ${errorMessage(err)}`;
    ctx.log.error(
      {
        jobRunId: info.jobRunId,
        siteId: info.siteId,
        attempt: info.attempt,
        willRetry,
        err: message,
      },
      'job failed',
    );
    try {
      await hooks.onFailure?.(err, willRetry);
    } finally {
      await ctx.prisma.jobRun.update({
        where: { id: info.jobRunId },
        data: {
          status: willRetry ? 'queued' : 'failed',
          finishedAt: willRetry ? null : new Date(),
          error: message.slice(0, 4000),
          meta: { ...tracker.toMeta(), durationMs: Date.now() - started } as never,
        },
      });
    }
    throw err;
  }
}
