import { createHash, randomBytes } from 'node:crypto';
import type { PrismaClient } from '@seo/db';
import {
  planFor,
  type AcceptInviteInput,
  type BrandingDto,
  type BrandingInput,
  type InvitationDto,
  type InvitationInfoDto,
  type InvitationLinkDto,
  type InviteInput,
  type MembersDto,
} from '@seo/shared';
import { AppError } from '../errors.js';
import { hashPassword } from '../password.js';
import type { CoreDeps } from './deps.js';

const INVITE_DAYS = 7;
const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

async function requireOwner(
  prisma: PrismaClient,
  organizationId: string,
  userId: string,
): Promise<void> {
  const user = await prisma.user.findFirst({ where: { id: userId, organizationId } });
  if (user?.role !== 'owner') {
    throw new AppError('OWNER_REQUIRED', 'Only the organization owner can manage members', {
      httpStatus: 403,
    });
  }
}

const toInvitationDto = (i: {
  id: string;
  email: string;
  role: string;
  expiresAt: Date;
}): InvitationDto => ({
  id: i.id,
  email: i.email,
  role: i.role,
  expiresAt: i.expiresAt.toISOString(),
});

export async function listMembers(
  deps: CoreDeps,
  organizationId: string,
  userId: string,
): Promise<MembersDto> {
  const [org, users, invitations] = await Promise.all([
    deps.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { plan: true },
    }),
    deps.prisma.user.findMany({ where: { organizationId }, orderBy: { createdAt: 'asc' } }),
    deps.prisma.invitation.findMany({
      where: { organizationId, acceptedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'asc' },
    }),
  ]);
  const me = users.find((u) => u.id === userId);
  return {
    members: users.map((u) => ({ id: u.id, email: u.email, role: u.role, isYou: u.id === userId })),
    invitations: invitations.map(toInvitationDto),
    maxMembers: planFor(org.plan).maxMembers,
    canManage: me?.role === 'owner',
  };
}

/**
 * Invitación por enlace (no enviamos emails): el propietario lo copia y se lo pasa a la persona.
 * Solo se guarda el hash del token; el enlace se muestra una única vez.
 */
export async function inviteMember(
  deps: CoreDeps,
  organizationId: string,
  userId: string,
  input: InviteInput,
  webOrigin: string,
): Promise<InvitationLinkDto> {
  await requireOwner(deps.prisma, organizationId, userId);
  const [org, members, pending, existing] = await Promise.all([
    deps.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { plan: true },
    }),
    deps.prisma.user.count({ where: { organizationId } }),
    deps.prisma.invitation.count({
      where: { organizationId, acceptedAt: null, expiresAt: { gt: new Date() } },
    }),
    deps.prisma.user.findUnique({ where: { email: input.email } }),
  ]);
  const max = planFor(org.plan).maxMembers;
  if (max !== null && members + pending >= max) {
    throw new AppError('MEMBER_LIMIT', `Plan ${org.plan} allows ${max} member(s)`, {
      httpStatus: 402,
    });
  }
  if (existing)
    throw new AppError('EMAIL_TAKEN', 'That email already has an account', { httpStatus: 409 });

  const token = randomBytes(32).toString('base64url');
  const invitation = await deps.prisma.invitation.create({
    data: {
      organizationId,
      email: input.email,
      role: input.role,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + INVITE_DAYS * 86_400_000),
    },
  });
  return {
    invitation: toInvitationDto(invitation),
    url: `${webOrigin.replace(/\/+$/, '')}/invite/${token}`,
  };
}

export async function revokeInvitation(
  deps: CoreDeps,
  organizationId: string,
  userId: string,
  invitationId: string,
): Promise<void> {
  await requireOwner(deps.prisma, organizationId, userId);
  const r = await deps.prisma.invitation.deleteMany({
    where: { id: invitationId, organizationId },
  });
  if (r.count === 0) throw new AppError('NOT_FOUND', 'Invitation not found', { httpStatus: 404 });
}

export async function updateMemberRole(
  deps: CoreDeps,
  organizationId: string,
  userId: string,
  memberId: string,
  role: 'member' | 'viewer',
): Promise<void> {
  await requireOwner(deps.prisma, organizationId, userId);
  const member = await deps.prisma.user.findFirst({ where: { id: memberId, organizationId } });
  if (!member) throw new AppError('NOT_FOUND', 'Member not found', { httpStatus: 404 });
  if (member.role === 'owner') {
    throw new AppError('INVALID_STATE', 'The owner role cannot be changed', { httpStatus: 409 });
  }
  await deps.prisma.user.update({ where: { id: member.id }, data: { role } });
}

/** Quita a un miembro (borra su usuario: su sesión deja de valer al instante). */
export async function removeMember(
  deps: CoreDeps,
  organizationId: string,
  userId: string,
  memberId: string,
): Promise<void> {
  await requireOwner(deps.prisma, organizationId, userId);
  const member = await deps.prisma.user.findFirst({ where: { id: memberId, organizationId } });
  if (!member) throw new AppError('NOT_FOUND', 'Member not found', { httpStatus: 404 });
  if (member.role === 'owner') {
    throw new AppError('INVALID_STATE', 'The owner cannot be removed', { httpStatus: 409 });
  }
  await deps.prisma.user.delete({ where: { id: member.id } });
}

async function findValidInvitation(prisma: PrismaClient, token: string) {
  const invitation = await prisma.invitation.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { organization: { select: { name: true } } },
  });
  if (!invitation || invitation.acceptedAt || invitation.expiresAt < new Date()) {
    throw new AppError('INVITATION_INVALID', 'Invitation not found or expired', {
      httpStatus: 404,
    });
  }
  return invitation;
}

/** Datos públicos de una invitación (para la pantalla de alta). */
export async function getInvitation(deps: CoreDeps, token: string): Promise<InvitationInfoDto> {
  const inv = await findValidInvitation(deps.prisma, token);
  return { organizationName: inv.organization.name, email: inv.email, role: inv.role };
}

/** Crea la cuenta del invitado dentro de la organización y consume la invitación. */
export async function acceptInvitation(
  deps: CoreDeps,
  input: AcceptInviteInput,
): Promise<{ id: string }> {
  const inv = await findValidInvitation(deps.prisma, input.token);
  if (await deps.prisma.user.findUnique({ where: { email: inv.email } })) {
    throw new AppError('EMAIL_TAKEN', 'That email already has an account', { httpStatus: 409 });
  }
  const passwordHash = await hashPassword(input.password);
  const [user] = await deps.prisma.$transaction([
    deps.prisma.user.create({
      data: { email: inv.email, passwordHash, role: inv.role, organizationId: inv.organizationId },
    }),
    deps.prisma.invitation.update({ where: { id: inv.id }, data: { acceptedAt: new Date() } }),
  ]);
  return { id: user.id };
}

export async function getBranding(deps: CoreDeps, organizationId: string): Promise<BrandingDto> {
  const org = await deps.prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });
  return {
    brandName: org.brandName,
    brandLogoUrl: org.brandLogoUrl,
    brandColor: org.brandColor,
    whiteLabel: planFor(org.plan).whiteLabel,
  };
}

export async function updateBranding(
  deps: CoreDeps,
  organizationId: string,
  userId: string,
  input: BrandingInput,
): Promise<BrandingDto> {
  await requireOwner(deps.prisma, organizationId, userId);
  const org = await deps.prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });
  if (!planFor(org.plan).whiteLabel) {
    throw new AppError('PLAN_FEATURE_REQUIRED', 'White label is not included in this plan', {
      httpStatus: 402,
    });
  }
  await deps.prisma.organization.update({ where: { id: organizationId }, data: input });
  return getBranding(deps, organizationId);
}
