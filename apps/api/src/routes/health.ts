import type { FastifyInstance } from 'fastify';
import type { HealthResponse } from '@seo/shared';

export interface HealthChecks {
  db: () => Promise<void>;
  redis: () => Promise<void>;
}

const CHECK_TIMEOUT_MS = 2000;

async function probe(check: () => Promise<void>): Promise<'ok' | 'error'> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      check(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('timeout')), CHECK_TIMEOUT_MS);
      }),
    ]);
    return 'ok';
  } catch {
    return 'error';
  } finally {
    clearTimeout(timer);
  }
}

export function healthRoutes(checks: HealthChecks) {
  return async (app: FastifyInstance): Promise<void> => {
    app.get('/health', async (_req, reply) => {
      const [db, redis] = await Promise.all([probe(checks.db), probe(checks.redis)]);
      const body: HealthResponse = {
        status: db === 'ok' && redis === 'ok' ? 'ok' : 'degraded',
        checks: { db, redis },
      };
      return reply.status(body.status === 'ok' ? 200 : 503).send(body);
    });
  };
}
