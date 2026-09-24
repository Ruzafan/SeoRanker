import type { PrismaClient } from '@seo/db';
import type { LoginInput, RegisterInput, UserDto } from '@seo/shared';
import { AppError } from '../errors.js';
import { hashPassword, verifyPassword } from '../password.js';

export interface AuthConfig {
  registrationEnabled: boolean;
  adminEmail?: string | undefined;
}

/** Hash fijo para igualar el tiempo de respuesta cuando el email no existe (evita enumerar usuarios). */
let dummyHash: Promise<string> | undefined;

export async function registrationOpen(prisma: PrismaClient, config: AuthConfig): Promise<boolean> {
  if (config.registrationEnabled) return true;
  // Bootstrap: el primer usuario siempre puede registrarse aunque el registro esté cerrado.
  return (await prisma.user.count()) === 0;
}

export async function registerUser(
  prisma: PrismaClient,
  input: RegisterInput,
  config: AuthConfig,
): Promise<{ id: string; organizationId: string }> {
  if (!(await registrationOpen(prisma, config))) {
    throw new AppError('REGISTRATION_DISABLED', 'Registration is disabled', { httpStatus: 403 });
  }
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) throw new AppError('EMAIL_TAKEN', 'Email already registered', { httpStatus: 409 });

  const passwordHash = await hashPassword(input.password);
  const org = await prisma.organization.create({
    data: {
      name: input.organizationName ?? input.email.split('@')[0] ?? 'Organization',
      users: { create: { email: input.email, passwordHash, role: 'owner' } },
    },
    include: { users: true },
  });
  const user = org.users[0];
  if (!user) throw new AppError('INTERNAL_ERROR', 'User creation failed');
  return { id: user.id, organizationId: org.id };
}

export async function verifyLogin(
  prisma: PrismaClient,
  input: LoginInput,
): Promise<{ id: string }> {
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  dummyHash ??= hashPassword('dummy-password-for-timing');
  const ok = await verifyPassword(user?.passwordHash ?? (await dummyHash), input.password);
  if (!user || !ok)
    throw new AppError('INVALID_CREDENTIALS', 'Invalid credentials', { httpStatus: 401 });
  return { id: user.id };
}

export async function getUserDto(
  prisma: PrismaClient,
  userId: string,
  config: AuthConfig,
): Promise<UserDto | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { organization: true },
  });
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    organizationId: user.organizationId,
    organizationName: user.organization.name,
    plan: user.organization.plan,
    isAdmin: !!config.adminEmail && user.email.toLowerCase() === config.adminEmail.toLowerCase(),
  };
}
