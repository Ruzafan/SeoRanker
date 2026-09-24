import type { Article, Keyword, Prisma, PrismaClient, Site } from '@seo/db';
import { notFound } from './errors.js';

/**
 * Aislamiento multi-tenant. TODA consulta a datos de un sitio pasa por aquí:
 * el `siteId` se inyecta siempre y no se puede sobrescribir desde `where`.
 * Un recurso ajeno se comporta como inexistente (404), nunca como prohibido.
 */
export type Db = Pick<
  PrismaClient,
  'keyword' | 'article' | 'jobRun' | 'usageRecord' | 'site' | 'organization' | 'user'
>;

/** El sitio existe y pertenece a la organización, o NOT_FOUND. */
export async function requireSite(
  prisma: Db,
  organizationId: string,
  siteId: string,
): Promise<Site> {
  const site = await prisma.site.findFirst({ where: { id: siteId, organizationId } });
  if (!site) throw notFound('Site');
  return site;
}

export async function requireKeyword(
  prisma: Db,
  organizationId: string,
  id: string,
): Promise<Keyword> {
  const kw = await prisma.keyword.findFirst({ where: { id, site: { organizationId } } });
  if (!kw) throw notFound('Keyword');
  return kw;
}

export async function requireArticle(
  prisma: Db,
  organizationId: string,
  id: string,
): Promise<Article> {
  const article = await prisma.article.findFirst({ where: { id, site: { organizationId } } });
  if (!article) throw notFound('Article');
  return article;
}

/** Acceso a datos de UN sitio, con `siteId` forzado en cada operación. */
export function siteScope(prisma: Db, siteId: string) {
  return {
    siteId,
    keywords: {
      findMany: (
        args: Omit<Prisma.KeywordFindManyArgs, 'where'> & { where?: Prisma.KeywordWhereInput } = {},
      ) => prisma.keyword.findMany({ ...args, where: { ...args.where, siteId } }),
      count: (where: Prisma.KeywordWhereInput = {}) =>
        prisma.keyword.count({ where: { ...where, siteId } }),
      findById: (id: string) => prisma.keyword.findFirst({ where: { id, siteId } }),
      createMany: (data: Omit<Prisma.KeywordCreateManyInput, 'siteId'>[]) =>
        prisma.keyword.createMany({
          data: data.map((d) => ({ ...d, siteId })),
          skipDuplicates: true,
        }),
      updateById: async (id: string, data: Prisma.KeywordUpdateManyMutationInput) => {
        const r = await prisma.keyword.updateMany({ where: { id, siteId }, data });
        if (r.count === 0) throw notFound('Keyword');
      },
      deleteById: async (id: string) => {
        const r = await prisma.keyword.deleteMany({ where: { id, siteId } });
        if (r.count === 0) throw notFound('Keyword');
      },
    },
    articles: {
      findMany: (
        args: Omit<Prisma.ArticleFindManyArgs, 'where'> & { where?: Prisma.ArticleWhereInput } = {},
      ) => prisma.article.findMany({ ...args, where: { ...args.where, siteId } }),
      count: (where: Prisma.ArticleWhereInput = {}) =>
        prisma.article.count({ where: { ...where, siteId } }),
      findById: (id: string) => prisma.article.findFirst({ where: { id, siteId } }),
      findByKeyword: (keywordId: string) =>
        prisma.article.findFirst({ where: { keywordId, siteId } }),
      create: (data: Omit<Prisma.ArticleUncheckedCreateInput, 'siteId'>) =>
        prisma.article.create({ data: { ...data, siteId } }),
      updateById: async (id: string, data: Prisma.ArticleUpdateManyMutationInput) => {
        const r = await prisma.article.updateMany({ where: { id, siteId }, data });
        if (r.count === 0) throw notFound('Article');
      },
      deleteById: async (id: string) => {
        const r = await prisma.article.deleteMany({ where: { id, siteId } });
        if (r.count === 0) throw notFound('Article');
      },
    },
    jobs: {
      findMany: (
        args: Omit<Prisma.JobRunFindManyArgs, 'where'> & { where?: Prisma.JobRunWhereInput } = {},
      ) => prisma.jobRun.findMany({ ...args, where: { ...args.where, siteId } }),
      count: (where: Prisma.JobRunWhereInput = {}) =>
        prisma.jobRun.count({ where: { ...where, siteId } }),
    },
  };
}

export type SiteScope = ReturnType<typeof siteScope>;
