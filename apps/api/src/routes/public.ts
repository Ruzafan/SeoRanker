import type { FastifyInstance } from 'fastify';
import { runDemo, type CoreDeps } from '@seo/core';
import { demoSchema } from '@seo/shared';

/** Rutas sin sesión para la landing. Límite estricto por IP: cada demo hace peticiones externas. */
export function publicRoutes(deps: CoreDeps) {
  return async (app: FastifyInstance): Promise<void> => {
    app.post(
      '/public/demo',
      { config: { rateLimit: { max: 6, timeWindow: '1 minute' } } },
      async (req) => {
        const { url } = demoSchema.parse(req.body);
        return runDemo(
          { fetchFn: deps.fetchFn, allowPrivateHosts: deps.config.allowPrivateHosts },
          url,
        );
      },
    );
  };
}
