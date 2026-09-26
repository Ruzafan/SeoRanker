import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@seo/db';
import {
  acceptInvitation,
  getInvitation,
  getUserDto,
  registerUser,
  registrationOpen,
  verifyLogin,
  AppError,
  type AuthConfig,
  type CoreDeps,
} from '@seo/core';
import { acceptInviteSchema, loginSchema, registerSchema } from '@seo/shared';
import { z } from 'zod';
import type { AuthHelpers } from '../plugins/auth.js';

export interface AuthRouteDeps {
  prisma: PrismaClient;
  auth: AuthHelpers;
  config: AuthConfig;
  loginRateLimitMax: number;
  core: CoreDeps;
}

export function authRoutes({ prisma, auth, config, loginRateLimitMax, core }: AuthRouteDeps) {
  const limited = { config: { rateLimit: { max: loginRateLimitMax, timeWindow: '1 minute' } } };

  return async (app: FastifyInstance): Promise<void> => {
    app.get('/auth/config', async () => ({
      registrationOpen: await registrationOpen(prisma, config),
    }));

    app.post('/auth/register', limited, async (req, reply) => {
      const input = registerSchema.parse(req.body);
      const user = await registerUser(prisma, input, config);
      await auth.startSession(reply, user.id);
      const dto = await getUserDto(prisma, user.id, config);
      return reply.status(201).send(dto);
    });

    app.post('/auth/login', limited, async (req, reply) => {
      const input = loginSchema.parse(req.body);
      const user = await verifyLogin(prisma, input);
      await auth.startSession(reply, user.id);
      return getUserDto(prisma, user.id, config);
    });

    // Invitaciones: públicas (el token del enlace es la credencial).
    app.get('/auth/invitations/:token', limited, async (req) => {
      const { token } = z.object({ token: z.string().min(20).max(200) }).parse(req.params);
      return getInvitation(core, token);
    });

    app.post('/auth/accept-invite', limited, async (req, reply) => {
      const user = await acceptInvitation(core, acceptInviteSchema.parse(req.body));
      await auth.startSession(reply, user.id);
      return reply.status(201).send(await getUserDto(prisma, user.id, config));
    });

    app.post('/auth/logout', async (_req, reply) => {
      auth.endSession(reply);
      return reply.status(204).send();
    });

    app.get('/auth/me', { preHandler: auth.requireAuth }, async (req) => {
      const dto = await getUserDto(prisma, req.auth.userId, config);
      if (!dto) throw new AppError('UNAUTHORIZED', 'Authentication required', { httpStatus: 401 });
      return dto;
    });
  };
}
