import { createBullBoard } from '@bull-board/api';
import type { BaseAdapter } from '@bull-board/api/dist/src/queueAdapters/base.js';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter.js';
import { FastifyAdapter } from '@bull-board/fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Queue } from 'bullmq';
import { AppError, type CoreDeps } from '@seo/core';
import type { Env } from './env.js';
import { registerAuth } from './plugins/auth.js';
import { registerErrorHandler } from './plugins/error-handler.js';
import { authRoutes } from './routes/auth.js';
import { billingRoutes } from './routes/billing.js';
import { integrationRoutes } from './routes/integrations.js';
import { healthRoutes, type HealthChecks } from './routes/health.js';
import { adminRoutes, resourceRoutes } from './routes/resources.js';

/** Rutas que nunca deben aparecer en logs con su valor. */
export const LOG_REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  '*.password',
  '*.credentials',
  '*.apiKey',
  '*.authorization',
  '*.wpAppPassword',
  '*.appPassword',
];

export type AppEnv = Pick<
  Env,
  | 'LOG_LEVEL'
  | 'WEB_ORIGIN'
  | 'JWT_SECRET'
  | 'COOKIE_SECURE'
  | 'REGISTRATION_ENABLED'
  | 'ADMIN_EMAIL'
  | 'LOGIN_RATE_LIMIT_MAX'
>;

export interface AppDeps {
  env: AppEnv;
  health: HealthChecks;
  core: CoreDeps;
  /** Si se pasan, se monta bull-board en /admin/queues (solo ADMIN_EMAIL). */
  boardQueues?: Queue[];
}

export async function buildApp({
  env,
  health,
  core,
  boardQueues,
}: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      redact: { paths: LOG_REDACT_PATHS, censor: '[REDACTED]' },
    },
    trustProxy: true,
  });

  registerErrorHandler(app);

  await app.register(helmet);
  await app.register(cors, { origin: env.WEB_ORIGIN, credentials: true });
  await app.register(cookie);
  await app.register(rateLimit, { global: true, max: 300, timeWindow: '1 minute' });

  const auth = await registerAuth(app, {
    jwtSecret: env.JWT_SECRET,
    cookieSecure: env.COOKIE_SECURE,
    prisma: core.prisma,
    adminEmail: env.ADMIN_EMAIL,
  });

  // /health en la raíz para healthchecks de contenedor y bajo /api/v1 como el resto de la API.
  await app.register(healthRoutes(health));
  await app.register(
    async (v1) => {
      await v1.register(healthRoutes(health));
      await v1.register(
        authRoutes({
          prisma: core.prisma,
          auth,
          config: { registrationEnabled: env.REGISTRATION_ENABLED, adminEmail: env.ADMIN_EMAIL },
          loginRateLimitMax: env.LOGIN_RATE_LIMIT_MAX,
        }),
      );
      await v1.register(billingRoutes(core, auth));
      await v1.register(integrationRoutes(core, auth, env.WEB_ORIGIN));
      await v1.register(resourceRoutes(core, auth));
      await v1.register(adminRoutes(core, auth));
    },
    { prefix: '/api/v1' },
  );

  if (boardQueues?.length) {
    const board = new FastifyAdapter();
    board.setBasePath('/admin/queues');
    // Los tipos de progreso de bull-board y bullmq difieren entre versiones; el runtime es compatible.
    const adapters = boardQueues.map((q) => new BullMQAdapter(q) as unknown as BaseAdapter);
    createBullBoard({ queues: adapters, serverAdapter: board });
    // La autenticación va en un hook GLOBAL (no dentro del plugin): bull-board instala su propio
    // manejador de errores, que devolvería 500 con el stack en vez de nuestro 404/401 uniforme.
    app.addHook('onRequest', async (req, reply) => {
      if (req.url !== '/admin/queues' && !req.url.startsWith('/admin/queues/')) return;
      try {
        await auth.requireAdmin(req);
      } catch (err) {
        if (!(err instanceof AppError)) throw err;
        // Se responde aquí en vez de lanzar: el error handler de la ruta sería el de bull-board.
        return reply
          .status(err.httpStatus)
          .send({ error: { code: err.code, message: err.message } });
      }
    });
    await app.register(async (scope) => {
      // El panel usa scripts inline: relajamos solo el CSP en esta ruta protegida.
      scope.addHook('onSend', async (_req, reply) => {
        void reply.removeHeader('content-security-policy');
      });
      await scope.register(board.registerPlugin(), {
        prefix: '/admin/queues',
        basePath: '/admin/queues',
      });
    });
  }

  return app;
}
