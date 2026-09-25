import type { FastifyInstance } from 'fastify';
import { AppError, completeGoogleConnect, errorCode, type CoreDeps } from '@seo/core';
import { googleCallbackSchema } from '@seo/shared';
import type { AuthHelpers } from '../plugins/auth.js';

/**
 * Vuelta de OAuth de Google. Es una navegación del navegador, no una llamada del panel:
 * siempre responde con una redirección al panel (nunca JSON), también en los errores.
 */
export function integrationRoutes(deps: CoreDeps, auth: AuthHelpers, webOrigin: string) {
  const base = webOrigin.replace(/\/+$/, '');
  return async (app: FastifyInstance): Promise<void> => {
    app.get('/integrations/google/callback', async (req, reply) => {
      try {
        await auth.requireAuth(req);
      } catch {
        return reply.redirect(`${base}/login`);
      }
      const parsed = googleCallbackSchema.safeParse(req.query);
      if (!parsed.success) return reply.redirect(`${base}/app?gsc=error&code=VALIDATION_ERROR`);
      const { state, code, error } = parsed.data;
      try {
        if (error || !code) {
          throw new AppError('GOOGLE_AUTH_FAILED', `Google consent: ${error ?? 'no code'}`, {
            httpStatus: 400,
          });
        }
        const { siteId } = await completeGoogleConnect(
          deps,
          req.auth.organizationId,
          req.auth.userId,
          state,
          code,
        );
        return reply.redirect(`${base}/sites/${siteId}/performance?gsc=connected`);
      } catch (err) {
        req.log.warn({ code: errorCode(err) }, 'google oauth callback failed');
        return reply.redirect(`${base}/app?gsc=error&code=${errorCode(err)}`);
      }
    });
  };
}
