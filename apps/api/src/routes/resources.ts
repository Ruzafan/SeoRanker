import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  analyzeVoice,
  batchKeywords,
  createKeywords,
  createSite,
  deleteArticle,
  deleteKeyword,
  deleteSite,
  discoverKeywords,
  generateFromKeyword,
  getArticle,
  getSiteStats,
  getUsage,
  listArticles,
  listJobs,
  listKeywords,
  listOrganizationsForAdmin,
  listSites,
  patchArticle,
  patchKeyword,
  publishArticle,
  regenerateArticle,
  requireSite,
  testSiteConnection,
  toArticleDto,
  toArticleSummary,
  toJobRunDto,
  toKeywordDto,
  toSiteDto,
  updateSite,
  type CoreDeps,
} from '@seo/core';
import {
  articleQuerySchema,
  batchKeywordsSchema,
  createKeywordsSchema,
  createSiteSchema,
  keywordQuerySchema,
  pageQuerySchema,
  patchArticleSchema,
  patchKeywordSchema,
  updateSiteSchema,
} from '@seo/shared';
import type { AuthHelpers } from '../plugins/auth.js';

const idParam = z.object({ id: z.string().min(1).max(64) });

/**
 * Rutas de recurso. Solo validan, llaman a un servicio de @seo/core y responden.
 * Cada servicio recibe organizationId y verifica la propiedad: un recurso ajeno es 404.
 */
export function resourceRoutes(deps: CoreDeps, auth: AuthHelpers) {
  return async (app: FastifyInstance): Promise<void> => {
    app.addHook('preHandler', auth.requireAuth);
    const org = (req: { auth: { organizationId: string } }) => req.auth.organizationId;
    const map = <T, U>(
      page: { items: T[]; page: number; pageSize: number; total: number },
      fn: (t: T) => U,
    ) => ({
      ...page,
      items: page.items.map(fn),
    });

    // ---- Sites ---------------------------------------------------------
    app.get('/sites', async (req) => (await listSites(deps, org(req))).map(toSiteDto));

    app.post('/sites', async (req, reply) => {
      const site = await createSite(deps, org(req), createSiteSchema.parse(req.body));
      return reply.status(201).send(toSiteDto(site));
    });

    app.get('/sites/:id', async (req) => {
      const { id } = idParam.parse(req.params);
      return toSiteDto(await requireSite(deps.prisma, org(req), id));
    });

    app.patch('/sites/:id', async (req) => {
      const { id } = idParam.parse(req.params);
      return toSiteDto(await updateSite(deps, org(req), id, updateSiteSchema.parse(req.body)));
    });

    app.delete('/sites/:id', async (req, reply) => {
      const { id } = idParam.parse(req.params);
      await deleteSite(deps, org(req), id);
      return reply.status(204).send();
    });

    app.post('/sites/:id/test-connection', async (req) => {
      const { id } = idParam.parse(req.params);
      return testSiteConnection(deps, org(req), id);
    });

    app.post('/sites/:id/analyze-voice', async (req, reply) => {
      const { id } = idParam.parse(req.params);
      return reply.status(202).send(await analyzeVoice(deps, org(req), id));
    });

    // ---- Keywords ------------------------------------------------------
    app.get('/sites/:id/keywords', async (req) => {
      const { id } = idParam.parse(req.params);
      const page = await listKeywords(deps, org(req), id, keywordQuerySchema.parse(req.query));
      return map(page, toKeywordDto);
    });

    app.post('/sites/:id/keywords', async (req, reply) => {
      const { id } = idParam.parse(req.params);
      const result = await createKeywords(deps, org(req), id, createKeywordsSchema.parse(req.body));
      return reply.status(201).send(result);
    });

    app.post('/sites/:id/keywords/discover', async (req, reply) => {
      const { id } = idParam.parse(req.params);
      return reply.status(202).send(await discoverKeywords(deps, org(req), id));
    });

    app.post('/sites/:id/keywords/batch', async (req) => {
      const { id } = idParam.parse(req.params);
      return batchKeywords(deps, org(req), id, batchKeywordsSchema.parse(req.body));
    });

    app.patch('/keywords/:id', async (req) => {
      const { id } = idParam.parse(req.params);
      return toKeywordDto(
        await patchKeyword(deps, org(req), id, patchKeywordSchema.parse(req.body)),
      );
    });

    app.delete('/keywords/:id', async (req, reply) => {
      const { id } = idParam.parse(req.params);
      await deleteKeyword(deps, org(req), id);
      return reply.status(204).send();
    });

    app.post('/keywords/:id/generate', async (req, reply) => {
      const { id } = idParam.parse(req.params);
      return reply.status(202).send(await generateFromKeyword(deps, org(req), id));
    });

    // ---- Articles ------------------------------------------------------
    app.get('/sites/:id/articles', async (req) => {
      const { id } = idParam.parse(req.params);
      const page = await listArticles(deps, org(req), id, articleQuerySchema.parse(req.query));
      return map(page, toArticleSummary);
    });

    app.get('/articles/:id', async (req) => {
      const { id } = idParam.parse(req.params);
      return toArticleDto(await getArticle(deps, org(req), id));
    });

    app.patch('/articles/:id', async (req) => {
      const { id } = idParam.parse(req.params);
      return toArticleDto(
        await patchArticle(deps, org(req), id, patchArticleSchema.parse(req.body)),
      );
    });

    app.delete('/articles/:id', async (req, reply) => {
      const { id } = idParam.parse(req.params);
      await deleteArticle(deps, org(req), id);
      return reply.status(204).send();
    });

    app.post('/articles/:id/publish', async (req, reply) => {
      const { id } = idParam.parse(req.params);
      return reply.status(202).send(await publishArticle(deps, org(req), id));
    });

    app.post('/articles/:id/regenerate', async (req, reply) => {
      const { id } = idParam.parse(req.params);
      return reply.status(202).send(await regenerateArticle(deps, org(req), id));
    });

    // ---- Jobs, uso y estadísticas -------------------------------------
    app.get('/sites/:id/jobs', async (req) => {
      const { id } = idParam.parse(req.params);
      const q = pageQuerySchema.parse(req.query);
      return map(await listJobs(deps, org(req), id, q.page, q.pageSize), toJobRunDto);
    });

    app.get('/sites/:id/usage', async (req) => {
      const { id } = idParam.parse(req.params);
      return getUsage(deps, org(req), id);
    });

    app.get('/sites/:id/stats', async (req) => {
      const { id } = idParam.parse(req.params);
      return getSiteStats(deps, org(req), id);
    });
  };
}

/** Vista de soporte: todas las organizaciones, solo lectura, solo ADMIN_EMAIL. */
export function adminRoutes(deps: CoreDeps, auth: AuthHelpers) {
  return async (app: FastifyInstance): Promise<void> => {
    app.addHook('preHandler', auth.requireAdmin);
    app.get('/admin/organizations', async () => listOrganizationsForAdmin(deps.prisma));
  };
}
