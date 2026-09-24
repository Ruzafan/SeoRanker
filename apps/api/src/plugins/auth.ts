import fastifyJwt from '@fastify/jwt';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { PrismaClient } from '@seo/db';
import { AppError } from '@seo/core';

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string };
    user: { sub: string };
  }
}

export interface AuthContext {
  userId: string;
  organizationId: string;
  email: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthContext;
  }
}

export const COOKIE_NAME = 'token';
const SESSION_DAYS = 7;

export interface AuthPluginOptions {
  jwtSecret: string;
  cookieSecure: boolean;
  prisma: PrismaClient;
  adminEmail?: string | undefined;
}

export interface AuthHelpers {
  requireAuth: (req: FastifyRequest) => Promise<void>;
  requireAdmin: (req: FastifyRequest) => Promise<void>;
  startSession: (reply: FastifyReply, userId: string) => Promise<void>;
  endSession: (reply: FastifyReply) => void;
}

/** JWT en cookie httpOnly, SameSite=Lax, Secure según entorno. */
export async function registerAuth(
  app: FastifyInstance,
  opts: AuthPluginOptions,
): Promise<AuthHelpers> {
  await app.register(fastifyJwt, {
    secret: opts.jwtSecret,
    cookie: { cookieName: COOKIE_NAME, signed: false },
    sign: { expiresIn: `${SESSION_DAYS}d` },
  });
  app.decorateRequest('auth', undefined as unknown as AuthContext);

  const requireAuth = async (req: FastifyRequest): Promise<void> => {
    try {
      await req.jwtVerify({ onlyCookie: true });
    } catch {
      throw new AppError('UNAUTHORIZED', 'Authentication required', { httpStatus: 401 });
    }
    // Se relee el usuario en cada petición: borrar/mover un usuario invalida su sesión al instante.
    const user = await opts.prisma.user.findUnique({
      where: { id: req.user.sub },
      select: { id: true, email: true, organizationId: true },
    });
    if (!user) throw new AppError('UNAUTHORIZED', 'Authentication required', { httpStatus: 401 });
    req.auth = { userId: user.id, organizationId: user.organizationId, email: user.email };
  };

  const requireAdmin = async (req: FastifyRequest): Promise<void> => {
    await requireAuth(req);
    // 404 en vez de 403: no revelamos que la ruta existe.
    if (!opts.adminEmail || req.auth.email.toLowerCase() !== opts.adminEmail.toLowerCase()) {
      throw new AppError('NOT_FOUND', 'Route not found', { httpStatus: 404 });
    }
  };

  const startSession = async (reply: FastifyReply, userId: string): Promise<void> => {
    const token = await reply.jwtSign({ sub: userId });
    void reply.setCookie(COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: opts.cookieSecure,
      path: '/',
      maxAge: SESSION_DAYS * 24 * 3600,
    });
  };

  const endSession = (reply: FastifyReply): void => {
    void reply.clearCookie(COOKIE_NAME, {
      httpOnly: true,
      sameSite: 'lax',
      secure: opts.cookieSecure,
      path: '/',
    });
  };

  return { requireAuth, requireAdmin, startSession, endSession };
}
