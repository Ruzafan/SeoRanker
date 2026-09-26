import type { FastifyInstance } from 'fastify';
import {
  getBilling,
  handleStripeWebhook,
  openBillingPortal,
  startCheckout,
  type CoreDeps,
} from '@seo/core';
import { checkoutSchema } from '@seo/shared';
import type { AuthHelpers } from '../plugins/auth.js';

/** Facturación de la organización. Solo el propietario contrata o abre el portal (OWNER_REQUIRED). */
export function billingRoutes(deps: CoreDeps, auth: AuthHelpers) {
  return async (app: FastifyInstance): Promise<void> => {
    app.get('/billing', { preHandler: auth.requireAuth }, async (req) =>
      getBilling(deps, req.auth.organizationId, req.auth.userId),
    );

    app.post('/billing/checkout', { preHandler: auth.requireAuth }, async (req) =>
      startCheckout(deps, req.auth.userId, checkoutSchema.parse(req.body)),
    );

    app.post('/billing/portal', { preHandler: auth.requireAuth }, async (req) =>
      openBillingPortal(deps, req.auth.userId),
    );

    // Webhook: sin sesión; la autenticidad la da la firma. Necesita el cuerpo sin parsear.
    await app.register(async (hook) => {
      hook.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) => {
        done(null, body);
      });
      hook.post('/billing/webhook', async (req) => {
        const signature = req.headers['stripe-signature'];
        return handleStripeWebhook(
          deps,
          req.body as Buffer,
          Array.isArray(signature) ? signature[0] : signature,
        );
      });
    });
  };
}
