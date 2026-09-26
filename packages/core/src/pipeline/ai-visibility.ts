import type { Site } from '@seo/db';
import { planFor } from '@seo/shared';
import { languageName } from '../ai/prompts/shared.js';
import { AppError } from '../errors.js';
import { siteScope } from '../tenant.js';
import { loadSite, modelFor } from './common.js';
import type { PipelineContext, RunInfo } from './context.js';
import { runTracked } from './run-tracked.js';

export const AI_VISIBILITY_PROMPT_VERSION = 'ai-visibility@1';
const MAX_QUESTIONS = 5;
const MAX_SEARCHES = 2;
/** Búsqueda web del servidor: 10 $ por 1000 búsquedas → 1 céntimo de dólar cada una. */
const SEARCH_COST_CENTS = 1;

const TEMPLATES: Record<string, { buy: (k: string) => string; advice: (k: string) => string }> = {
  es: {
    buy: (k) => `¿Dónde puedo comprar ${k} online?`,
    advice: (k) => `${k}: ¿qué me recomiendas y dónde lo encuentro?`,
  },
  en: {
    buy: (k) => `Where can I buy ${k} online?`,
    advice: (k) => `${k}: what do you recommend and where can I find it?`,
  },
  fr: {
    buy: (k) => `Où acheter ${k} en ligne ?`,
    advice: (k) => `${k} : que me conseilles-tu et où le trouver ?`,
  },
  de: {
    buy: (k) => `Wo kann ich ${k} online kaufen?`,
    advice: (k) => `${k}: Was empfiehlst du und wo finde ich es?`,
  },
  pt: {
    buy: (k) => `Onde posso comprar ${k} online?`,
    advice: (k) => `${k}: o que você recomenda e onde encontro?`,
  },
  it: {
    buy: (k) => `Dove posso comprare ${k} online?`,
    advice: (k) => `${k}: cosa mi consigli e dove lo trovo?`,
  },
};

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Preguntas de comprador a partir de las mejores keywords (las comerciales primero). */
export function buyerQuestions(
  keywords: { term: string; intent: string | null }[],
  language: string,
): string[] {
  const t = TEMPLATES[language] ??
    TEMPLATES['en'] ?? { buy: (k: string) => k, advice: (k: string) => k };
  const commercial = keywords.filter(
    (k) => k.intent === 'commercial' || k.intent === 'transactional',
  );
  const rest = keywords.filter((k) => !commercial.includes(k));
  return [...commercial.map((k) => t.buy(k.term)), ...rest.map((k) => cap(t.advice(k.term)))]
    .filter((q, i, all) => all.indexOf(q) === i)
    .slice(0, MAX_QUESTIONS);
}

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** ¿La respuesta nombra la tienda (por su nombre o su dominio)? */
export function mentions(text: string, site: Pick<Site, 'name' | 'url'>): boolean {
  const t = fold(text);
  const host = hostOf(site.url);
  const name = fold(site.name).trim();
  return (!!host && t.includes(host)) || (name.length >= 3 && t.includes(name));
}

/**
 * Visibilidad en asistentes de IA: hace a Claude, con búsqueda web, las preguntas que haría un
 * comprador y anota si la respuesta menciona la tienda, si cita alguna de sus páginas y qué otros
 * dominios cita. No menciona la tienda en la pregunta para no sesgar la respuesta.
 */
export function runAiVisibility(ctx: PipelineContext, info: RunInfo): Promise<void> {
  return runTracked(ctx, info, async (tracker) => {
    const site = await loadSite(ctx, info.siteId);
    const org = await ctx.prisma.organization.findUniqueOrThrow({
      where: { id: site.organizationId },
      select: { plan: true },
    });
    if (!planFor(org.plan).aiVisibility) {
      throw new AppError('PLAN_FEATURE_REQUIRED', 'AI visibility is not included in this plan', {
        httpStatus: 402,
      });
    }
    const keywords = await siteScope(ctx.prisma, site.id).keywords.findMany({
      where: { status: { in: ['pending', 'queued', 'processing', 'done'] } },
      orderBy: [{ score: 'desc' }],
      take: 30,
      select: { term: true, intent: true },
    });
    const questions = buyerQuestions(keywords, site.language);
    if (!questions.length) return { meta: { skipped: 'NO_KEYWORDS' } };

    const lang = languageName(site.language);
    const host = hostOf(site.url);
    let mentioned = 0;
    for (const prompt of questions) {
      const r = await ctx.claude.searchAnswer({
        model: modelFor(ctx, site),
        system: `You are a helpful AI assistant answering a shopper in ${site.country}. Search the web, then answer in ${lang} the way you normally would, in under 200 words: recommend specific stores, brands or products and cite your sources.`,
        user: prompt,
        maxTokens: 1500,
        maxSearches: MAX_SEARCHES,
        country: site.country,
      });
      await tracker.add(r.model, r.usage);
      await tracker.addCost(r.searches * SEARCH_COST_CENTS);

      const cited = r.citedUrls.length ? r.citedUrls : r.sources.map((s) => s.url);
      const isMentioned = mentions(r.text, site);
      if (isMentioned) mentioned++;
      await ctx.prisma.aiVisibilityCheck.create({
        data: {
          siteId: site.id,
          runId: info.jobRunId,
          prompt,
          mentioned: isMentioned,
          cited: cited.some((u) => hostOf(u) === host),
          competitors: [...new Set(cited.map(hostOf).filter((h) => h && h !== host))].slice(0, 6),
          answer: r.text.slice(0, 8000),
        },
      });
    }
    return {
      meta: { questions: questions.length, mentioned, prompt: AI_VISIBILITY_PROMPT_VERSION },
    };
  });
}
