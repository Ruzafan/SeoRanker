import {
  clusterKeywordsSchema,
  clusterKeywordsSystem,
  clusterKeywordsToolDescription,
  clusterKeywordsUser,
  CLUSTER_KEYWORDS_PROMPT_VERSION,
} from '../ai/prompts/cluster-keywords.js';
import { normalizeTerm } from '../keywords/provider.js';
import { siteScope } from '../tenant.js';
import { loadSite, modelFor, siteContext } from './common.js';
import type { PipelineContext, RunInfo } from './context.js';
import { runTracked } from './run-tracked.js';

const MAX_KEYWORDS = 400;

/**
 * Agrupa en clusters temáticos las keywords vivas del sitio (pendientes, en curso y hechas) y marca
 * la pilar de cada uno. Rehace la agrupación completa: los clusters anteriores se sustituyen.
 */
export function runCluster(ctx: PipelineContext, info: RunInfo): Promise<void> {
  return runTracked(ctx, info, async (tracker) => {
    const site = await loadSite(ctx, info.siteId);
    const scope = siteScope(ctx.prisma, site.id);
    const keywords = await scope.keywords.findMany({
      where: { status: { in: ['pending', 'queued', 'processing', 'done'] } },
      orderBy: [{ score: 'desc' }],
      take: MAX_KEYWORDS,
      select: { id: true, term: true },
    });
    if (keywords.length < 3)
      return { meta: { skipped: 'TOO_FEW_KEYWORDS', keywords: keywords.length } };

    const result = await ctx.claude.callTool({
      model: modelFor(ctx, site),
      system: clusterKeywordsSystem(siteContext(site)),
      user: clusterKeywordsUser(keywords.map((k) => k.term)),
      maxTokens: 8000,
      toolDescription: clusterKeywordsToolDescription,
      schema: clusterKeywordsSchema,
    });
    await tracker.add(result.model, result.usage);

    const byTerm = new Map(keywords.map((k) => [k.term, k.id]));
    const assigned = new Set<string>();
    const plan = result.data.clusters
      .map((c) => {
        const ids = c.keywords
          .map((t) => byTerm.get(normalizeTerm(t)))
          .filter((id): id is string => !!id && !assigned.has(id));
        ids.forEach((id) => assigned.add(id));
        const pillarId = byTerm.get(normalizeTerm(c.pillar));
        return {
          name: c.name.trim().slice(0, 80),
          ids,
          // La pilar tiene que ser del propio cluster; si Claude se equivoca, la primera.
          pillarId: pillarId && ids.includes(pillarId) ? pillarId : (ids[0] ?? null),
        };
      })
      .filter((c) => c.ids.length > 0);

    await ctx.prisma.$transaction(async (tx) => {
      await tx.keyword.updateMany({ where: { siteId: site.id }, data: { clusterId: null } });
      await tx.keywordCluster.deleteMany({ where: { siteId: site.id } });
      for (const c of plan) {
        const cluster = await tx.keywordCluster.create({
          data: { siteId: site.id, name: c.name, pillarKeywordId: c.pillarId },
        });
        await tx.keyword.updateMany({
          where: { siteId: site.id, id: { in: c.ids } },
          data: { clusterId: cluster.id },
        });
      }
    });
    return {
      meta: {
        clusters: plan.length,
        keywords: keywords.length,
        unassigned: keywords.length - assigned.size,
        prompt: CLUSTER_KEYWORDS_PROMPT_VERSION,
      },
    };
  });
}
