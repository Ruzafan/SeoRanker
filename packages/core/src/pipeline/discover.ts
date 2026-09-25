import { parseSettings } from '@seo/shared';
import {
  normalizeScore,
  scoreKeywordsSchema,
  scoreKeywordsSystem,
  scoreKeywordsToolDescription,
  scoreKeywordsUser,
  SCORE_KEYWORDS_PROMPT_VERSION,
} from '../ai/prompts/score-keywords.js';
import {
  AutocompleteProvider,
  SerpApiPaaProvider,
  defaultHttpDeps,
  normalizeTerm,
  type HttpDeps,
  type KeywordCandidate,
  type KeywordProvider,
} from '../keywords/provider.js';
import { siteScope } from '../tenant.js';
import { blendScore, type KeywordMetrics } from '../keywords/metrics.js';
import { loadSite, metricsProviderFor, modelFor, siteContext } from './common.js';
import type { PipelineContext, RunInfo } from './context.js';
import { runTracked } from './run-tracked.js';
import { startFirstArticle } from './onboarding.js';
import { generateSeeds } from './seeds.js';

const MAX_CANDIDATES = 300;
const SCORE_BATCH = 60;

function httpDeps(ctx: PipelineContext): HttpDeps {
  return {
    fetchFn: ctx.fetchFn ?? defaultHttpDeps.fetchFn,
    sleep: ctx.sleep ?? defaultHttpDeps.sleep,
    random: ctx.random ?? defaultHttpDeps.random,
  };
}

export function runDiscover(ctx: PipelineContext, info: RunInfo): Promise<void> {
  return runTracked(ctx, info, async (tracker) => {
    const site = await loadSite(ctx, info.siteId);
    let settings = parseSettings(site.settings);
    // Sin seeds: se deducen del contenido de la tienda y se guardan (el usuario puede editarlas).
    const seedsGenerated = settings.seeds.length === 0;
    if (seedsGenerated) {
      settings = { ...settings, seeds: await generateSeeds(ctx, site, tracker) };
      await ctx.prisma.site.update({ where: { id: site.id }, data: { settings } });
    }

    const deps = httpDeps(ctx);
    const providers: KeywordProvider[] = [new AutocompleteProvider(deps)];
    if (ctx.config.serpApiKey) {
      providers.push(
        new SerpApiPaaProvider(ctx.config.serpApiKey, deps, (msg) =>
          ctx.log.warn({ siteId: site.id, msg }, 'serpapi paa failed'),
        ),
      );
    }

    // 1. Expandir. Un rate limit de Autocomplete aborta el trabajo (RATE_LIMITED) en el propio provider.
    const candidates = new Map<string, KeywordCandidate>();
    for (const seed of settings.seeds) {
      for (const provider of providers) {
        for (const c of await provider.expand(seed, {
          language: site.language,
          country: site.country,
        })) {
          if (!candidates.has(c.term)) candidates.set(c.term, c);
        }
      }
    }
    const seedSet = new Set(settings.seeds.map(normalizeTerm));

    // 2. Quitar lo que ya existe y acotar.
    const scope = siteScope(ctx.prisma, site.id);
    const terms = [...candidates.keys()];
    const existing = new Set<string>();
    for (let i = 0; i < terms.length; i += 1000) {
      const rows = await scope.keywords.findMany({
        where: { term: { in: terms.slice(i, i + 1000) } },
        select: { term: true },
      });
      rows.forEach((r) => existing.add(r.term));
    }
    const fresh = terms.filter((t) => !existing.has(t) && !seedSet.has(t)).slice(0, MAX_CANDIDATES);

    // 3. Puntuar con Claude por lotes; si hay proveedor de métricas, se mezcla con la demanda real.
    const model = modelFor(ctx, site);
    const metricsProvider = metricsProviderFor(ctx);
    let withMetrics = 0;
    let inserted = 0;
    let discarded = 0;
    for (let i = 0; i < fresh.length; i += SCORE_BATCH) {
      const batch = fresh.slice(i, i + SCORE_BATCH);
      const result = await ctx.claude.callTool({
        model,
        system: scoreKeywordsSystem(siteContext(site)),
        user: scoreKeywordsUser(settings.seeds, batch),
        maxTokens: 4096,
        toolDescription: scoreKeywordsToolDescription,
        schema: scoreKeywordsSchema,
      });
      await tracker.add(result.model, result.usage);

      const wanted = new Set(batch);
      const rows = result.data.keywords
        .map((k) => ({ ...k, term: normalizeTerm(k.term) }))
        .filter((k) => wanted.has(k.term));
      const kept = rows.filter((k) => k.keep);
      discarded += batch.length - kept.length;
      let metrics = new Map<string, KeywordMetrics>();
      if (metricsProvider && kept.length) {
        try {
          metrics = await metricsProvider.getMetrics(
            kept.map((k) => k.term),
            { language: site.language, country: site.country },
          );
          withMetrics += metrics.size;
        } catch (err) {
          // Sin métricas se sigue con la puntuación de Claude: no merece tirar el descubrimiento.
          ctx.log.warn({ siteId: site.id, err: String(err) }, 'keyword metrics unavailable');
        }
      }
      const created = await scope.keywords.createMany(
        kept.map((k) => {
          const c = candidates.get(k.term);
          const { score, intent } = normalizeScore(k.score, k.intent);
          const m = metrics.get(k.term);
          return {
            term: k.term,
            source: c?.source ?? 'autocomplete',
            seedTerm: c?.seedTerm ?? null,
            score: blendScore(score, m),
            intent,
            status: 'pending',
            volume: m?.volume ?? null,
            difficulty: m?.difficulty ?? null,
            cpc: m?.cpc ?? null,
          };
        }),
      );
      inserted += created.count;
    }

    // Se releen los ajustes: el usuario (o una prueba de conexión) pudo cambiarlos mientras tanto.
    const latest = parseSettings((await loadSite(ctx, site.id)).settings);
    const onboarding = latest.onboarding === 'pending';
    await ctx.prisma.site.update({
      where: { id: site.id },
      data: {
        settings: {
          ...latest,
          seeds: settings.seeds,
          lastDiscoverAt: new Date().toISOString(),
          ...(onboarding ? { onboarding: 'done' as const } : {}),
        },
      },
    });
    const firstArticle = onboarding ? await startFirstArticle(ctx, site.id) : undefined;

    return {
      meta: {
        seeds: settings.seeds.length,
        seedsGenerated,
        providers: providers.map((p) => p.name),
        candidates: candidates.size,
        scored: fresh.length,
        inserted,
        discarded,
        withMetrics,
        ...(firstArticle ? { firstArticle } : {}),
        prompt: SCORE_KEYWORDS_PROMPT_VERSION,
      },
    };
  });
}
