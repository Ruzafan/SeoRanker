import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  getBranding,
  inviteMember,
  listMembers,
  removeMember,
  revokeInvitation,
  updateBranding,
  updateMemberRole,
  type CoreDeps,
} from '@seo/core';
import { brandingSchema, inviteSchema, memberRoleSchema } from '@seo/shared';
import type { AuthHelpers } from '../plugins/auth.js';

const idParam = z.object({ id: z.string().min(1).max(64) });

/** Miembros, invitaciones y marca de la organización. Los cambios, solo el propietario (OWNER_REQUIRED). */
export function organizationRoutes(deps: CoreDeps, auth: AuthHelpers, webOrigin: string) {
  return async (app: FastifyInstance): Promise<void> => {
    app.addHook('preHandler', auth.requireAuth);
    const org = (req: { auth: { organizationId: string } }) => req.auth.organizationId;

    app.get('/organization/members', async (req) => listMembers(deps, org(req), req.auth.userId));

    app.post('/organization/invitations', async (req, reply) =>
      reply
        .status(201)
        .send(
          await inviteMember(
            deps,
            org(req),
            req.auth.userId,
            inviteSchema.parse(req.body),
            webOrigin,
          ),
        ),
    );

    app.delete('/organization/invitations/:id', async (req, reply) => {
      const { id } = idParam.parse(req.params);
      await revokeInvitation(deps, org(req), req.auth.userId, id);
      return reply.status(204).send();
    });

    app.patch('/organization/members/:id', async (req, reply) => {
      const { id } = idParam.parse(req.params);
      await updateMemberRole(
        deps,
        org(req),
        req.auth.userId,
        id,
        memberRoleSchema.parse(req.body).role,
      );
      return reply.status(204).send();
    });

    app.delete('/organization/members/:id', async (req, reply) => {
      const { id } = idParam.parse(req.params);
      await removeMember(deps, org(req), req.auth.userId, id);
      return reply.status(204).send();
    });

    app.get('/organization/branding', async (req) => getBranding(deps, org(req)));

    app.put('/organization/branding', async (req) =>
      updateBranding(deps, org(req), req.auth.userId, brandingSchema.parse(req.body)),
    );
  };
}
