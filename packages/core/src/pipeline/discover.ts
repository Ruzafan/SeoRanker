import { parseSettings } from '@seo/shared';
import { AppError } from '../errors.js';
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
import { loadSite, modelFor, siteContext } from './common.js';
import type { PipelineContext, RunInfo } from './context.js';
import { runTracked } from './run-tracked.js';

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
    const settings = parseSettings(site.settings);
    if (settings.seeds.length === 0) {
      throw new AppError('NO_SEEDS', 'The site has no seed keywords configured', {
        httpStatus: 400,
      });
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

    // 3. Puntuar con Claude por lotes.
    const model = modelFor(ctx, site);
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
      const created = await scope.keywords.createMany(
        kept.map((k) => {
          const c = candidates.get(k.term);
          const { score, intent } = normalizeScore(k.score, k.intent);
          return {
            term: k.term,
            source: c?.source ?? 'autocomplete',
            seedTerm: c?.seedTerm ?? null,
            score,
            intent,
            status: 'pending',
          };
        }),
      );
      inserted += created.count;
    }

    await ctx.prisma.site.update({
      where: { id: site.id },
      data: { settings: { ...settings, lastDiscoverAt: new Date().toISOString() } },
    });

    return {
      meta: {
        seeds: settings.seeds.length,
        providers: providers.map((p) => p.name),
        candidates: candidates.size,
        scored: fresh.length,
        inserted,
        discarded,
        prompt: SCORE_KEYWORDS_PROMPT_VERSION,
      },
    };
  });
}
