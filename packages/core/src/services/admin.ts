import type { PrismaClient } from '@seo/db';
import type { OrganizationAdminDto } from '@seo/shared';

/** Vista de soporte, solo lectura, de todas las organizaciones. Nunca expone credenciales. */
export async function listOrganizationsForAdmin(
  prisma: PrismaClient,
): Promise<OrganizationAdminDto[]> {
  const orgs = await prisma.organization.findMany({
    orderBy: { createdAt: 'asc' },
    include: {
      users: { select: { id: true, email: true, role: true } },
      sites: {
        select: {
          id: true,
          name: true,
          url: true,
          active: true,
          _count: { select: { articles: true, keywords: true } },
        },
      },
    },
  });
  return orgs.map((o) => ({
    id: o.id,
    name: o.name,
    plan: o.plan,
    createdAt: o.createdAt.toISOString(),
    users: o.users,
    sites: o.sites.map((s) => ({
      id: s.id,
      name: s.name,
      url: s.url,
      active: s.active,
      articles: s._count.articles,
      keywords: s._count.keywords,
    })),
  }));
}
