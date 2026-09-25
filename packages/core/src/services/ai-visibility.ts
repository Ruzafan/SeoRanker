import { planFor, type AiVisibilityDto, type EnqueuedDto } from '@seo/shared';
import { AppError } from '../errors.js';
import { requireSite } from '../tenant.js';
import type { CoreDeps } from './deps.js';

const HISTORY_RUNS = 12;
const COMPETITOR_RUNS = 4;

export async function getAiVisibility(
  deps: CoreDeps,
  organizationId: string,
  siteId: string,
): Promise<AiVisibilityDto> {
  const site = await requireSite(deps.prisma, organizationId, siteId);
  const org = await deps.prisma.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { plan: true },
  });
  const checks = await deps.prisma.aiVisibilityCheck.findMany({
    where: { siteId: site.id },
    orderBy: { createdAt: 'desc' },
    take: HISTORY_RUNS * 10,
  });
  // Agrupa por ejecución, de la más reciente a la más antigua.
  const runs: { runId: string; at: Date; items: typeof checks }[] = [];
  for (const c of checks) {
    const run = runs.find((r) => r.runId === c.runId);
    if (run) run.items.push(c);
    else runs.push({ runId: c.runId, at: c.createdAt, items: [c] });
  }
  const rate = (items: typeof checks) => items.filter((c) => c.mentioned).length / items.length;
  const latest = runs[0];
  const counts = new Map<string, number>();
  for (const r of runs.slice(0, COMPETITOR_RUNS))
    for (const c of r.items) for (const d of c.competitors) counts.set(d, (counts.get(d) ?? 0) + 1);

  return {
    enabled: planFor(org.plan).aiVisibility,
    lastRunAt: latest?.at.toISOString() ?? null,
    mentionRate: latest ? rate(latest.items) : null,
    // En el orden en que se preguntaron.
    checks: [...(latest?.items ?? [])].reverse().map((c) => ({
      prompt: c.prompt,
      mentioned: c.mentioned,
      cited: c.cited,
      competitors: c.competitors,
    })),
    history: runs
      .slice(0, HISTORY_RUNS)
      .reverse()
      .map((r) => ({ date: r.at.toISOString(), mentionRate: rate(r.items) })),
    topCompetitors: [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([domain, count]) => ({ domain, count })),
  };
}

export async function runAiVisibilityNow(
  deps: CoreDeps,
  organizationId: string,
  siteId: string,
): Promise<EnqueuedDto> {
  const site = await requireSite(deps.prisma, organizationId, siteId);
  const org = await deps.prisma.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { plan: true },
  });
  if (!planFor(org.plan).aiVisibility) {
    throw new AppError('PLAN_FEATURE_REQUIRED', 'AI visibility is not included in this plan', {
      httpStatus: 402,
    });
  }
  return deps.dispatcher.enqueue('ai-visibility', { siteId: site.id });
}
