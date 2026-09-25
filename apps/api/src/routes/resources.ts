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
  getArticleDto,
  addComment,
  getCalendar,
  getMonthlyReport,
  listComments,
  refreshArticle,
  restorePreviousVersion,
  reviewArticle,
  getPerformance,
  getSearchConsoleStatus,
  listSearchConsoleProperties,
  listSiteAuthors,
  listClusters,
  rebuildClusters,
  selectSearchConsoleProperty,
  disconnectSearchConsole,
  startGoogleConnect,
  syncSiteNow,
  getSiteStats,
  getSitesOverview,
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
  toArticleSummary,
  toJobRunDto,
  toKeywordDto,
  toSiteDto,
  updateSite,
  type CoreDeps,
} from '@seo/core';
import {
  articleQuerySchema,
  calendarQuerySchema,
  commentSchema,
  reportQuerySchema,
  reviewSchema,
  batchKeywordsSchema,
  createKeywordsSchema,
  createSiteSchema,
  keywordQuerySchema,
  pageQuerySchema,
  patchArticleSchema,
  patchKeywordSchema,
  selectPropertySchema,
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
    app.addHook('preHandler', auth.requireWriter);
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
    app.get('/sites/overview', async (req) => getSitesOverview(deps, org(req)));

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

    app.get('/sites/:id/authors', async (req) => {
      const { id } = idParam.parse(req.params);
      return listSiteAuthors(deps, org(req), id);
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

    app.get('/sites/:id/clusters', async (req) => {
      const { id } = idParam.parse(req.params);
      return listClusters(deps, org(req), id);
    });

    app.post('/sites/:id/clusters/rebuild', async (req, reply) => {
      const { id } = idParam.parse(req.params);
      return reply.status(202).send(await rebuildClusters(deps, org(req), id));
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
      return getArticleDto(deps, org(req), id);
    });

    app.patch('/articles/:id', async (req) => {
      const { id } = idParam.parse(req.params);
      await patchArticle(deps, org(req), id, patchArticleSchema.parse(req.body));
      return getArticleDto(deps, org(req), id);
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

    // ---- Flujo editorial ------------------------------------------------
    app.post('/articles/:id/refresh', async (req, reply) => {
      const { id } = idParam.parse(req.params);
      return reply.status(202).send(await refreshArticle(deps, org(req), id));
    });

    app.post('/articles/:id/restore', async (req) => {
      const { id } = idParam.parse(req.params);
      await restorePreviousVersion(deps, org(req), id);
      return getArticleDto(deps, org(req), id);
    });

    app.post('/articles/:id/review', { config: { viewerAllowed: true } }, async (req) => {
      const { id } = idParam.parse(req.params);
      await reviewArticle(deps, org(req), req.auth.userId, id, reviewSchema.parse(req.body));
      return getArticleDto(deps, org(req), id);
    });

    app.get('/articles/:id/comments', async (req) => {
      const { id } = idParam.parse(req.params);
      return listComments(deps, org(req), id);
    });

    app.post('/articles/:id/comments', { config: { viewerAllowed: true } }, async (req, reply) => {
      const { id } = idParam.parse(req.params);
      const { body } = commentSchema.parse(req.body);
      return reply.status(201).send(await addComment(deps, org(req), req.auth.userId, id, body));
    });

    app.get('/sites/:id/calendar', async (req) => {
      const { id } = idParam.parse(req.params);
      const q = calendarQuerySchema.parse(req.query);
      return getCalendar(deps, org(req), id, new Date(q.from), new Date(q.to));
    });

    app.get('/sites/:id/report', async (req) => {
      const { id } = idParam.parse(req.params);
      return getMonthlyReport(deps, org(req), id, reportQuerySchema.parse(req.query).month);
    });

    // ---- Search Console, sincronización y rendimiento -----------------
    app.get('/sites/:id/search-console', async (req) => {
      const { id } = idParam.parse(req.params);
      return getSearchConsoleStatus(deps, org(req), id);
    });

    app.post('/sites/:id/search-console/connect', async (req) => {
      const { id } = idParam.parse(req.params);
      return startGoogleConnect(deps, org(req), req.auth.userId, id);
    });

    app.get('/sites/:id/search-console/properties', async (req) => {
      const { id } = idParam.parse(req.params);
      return listSearchConsoleProperties(deps, org(req), id);
    });

    app.patch('/sites/:id/search-console', async (req) => {
      const { id } = idParam.parse(req.params);
      return selectSearchConsoleProperty(deps, org(req), id, selectPropertySchema.parse(req.body));
    });

    app.delete('/sites/:id/search-console', async (req, reply) => {
      const { id } = idParam.parse(req.params);
      await disconnectSearchConsole(deps, org(req), id);
      return reply.status(204).send();
    });

    app.post('/sites/:id/sync', async (req, reply) => {
      const { id } = idParam.parse(req.params);
      return reply.status(202).send(await syncSiteNow(deps, org(req), id));
    });

    app.get('/sites/:id/performance', async (req) => {
      const { id } = idParam.parse(req.params);
      return getPerformance(deps, org(req), id);
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
