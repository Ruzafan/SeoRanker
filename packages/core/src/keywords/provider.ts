import { AppError } from '../errors.js';

export type KeywordSource = 'autocomplete' | 'paa' | 'gsc' | 'import';

export interface KeywordCandidate {
  term: string;
  source: KeywordSource;
  seedTerm: string;
}

export interface ExpandContext {
  language: string;
  country: string;
}

/** Punto de extensión: Search Console, DataForSEO… se añaden implementando esto, sin tocar el pipeline. */
export interface KeywordProvider {
  readonly name: string;
  expand(seed: string, ctx: ExpandContext): Promise<KeywordCandidate[]>;
}

export interface HttpDeps {
  fetchFn: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  random: () => number;
}

export const defaultHttpDeps: HttpDeps = {
  fetchFn: (...args) => fetch(...args),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  random: Math.random,
};

const QUESTION_MODIFIERS: Record<string, string[]> = {
  es: ['cómo', 'qué', 'por qué', 'cuál', 'dónde', 'cuánto', 'cuándo', 'para qué', 'mejor'],
  en: ['how', 'what', 'why', 'which', 'where', 'when', 'can', 'best'],
  fr: ['comment', 'que', 'pourquoi', 'quel', 'où', 'combien', 'quand', 'meilleur'],
  de: ['wie', 'was', 'warum', 'welche', 'wo', 'wann', 'beste'],
  pt: ['como', 'o que', 'por que', 'qual', 'onde', 'quanto', 'quando', 'melhor'],
  it: ['come', 'cosa', 'perché', 'quale', 'dove', 'quanto', 'quando', 'migliore'],
};

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz'.split('');
const MAX_CONSECUTIVE_FAILURES = 3;

export function questionModifiers(language: string): string[] {
  return QUESTION_MODIFIERS[language] ?? QUESTION_MODIFIERS['en'] ?? [];
}

export function normalizeTerm(term: string): string {
  return term.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Google Autocomplete: alphabet soup + modificadores de pregunta, con jitter y corte por rate limit. */
export class AutocompleteProvider implements KeywordProvider {
  readonly name = 'autocomplete';
  private consecutiveFailures = 0;
  private requests = 0;

  constructor(private readonly deps: HttpDeps = defaultHttpDeps) {}

  private queriesFor(seed: string, language: string): string[] {
    return [
      seed,
      ...ALPHABET.map((l) => `${seed} ${l}`),
      ...questionModifiers(language).map((m) => `${m} ${seed}`),
    ];
  }

  async expand(seed: string, ctx: ExpandContext): Promise<KeywordCandidate[]> {
    const found = new Map<string, KeywordCandidate>();
    for (const q of this.queriesFor(seed, ctx.language)) {
      if (this.requests > 0) await this.deps.sleep(400 + Math.floor(this.deps.random() * 400));
      this.requests++;
      const suggestions = await this.fetchSuggestions(q, ctx);
      for (const s of suggestions) {
        const term = normalizeTerm(s);
        if (term.length >= 2 && !found.has(term)) {
          found.set(term, { term, source: 'autocomplete', seedTerm: seed });
        }
      }
    }
    return [...found.values()];
  }

  private async fetchSuggestions(query: string, ctx: ExpandContext): Promise<string[]> {
    const url =
      'https://suggestqueries.google.com/complete/search?client=firefox' +
      `&hl=${encodeURIComponent(ctx.language)}&gl=${encodeURIComponent(ctx.country)}` +
      `&q=${encodeURIComponent(query)}`;
    let ok = false;
    let suggestions: string[] = [];
    try {
      const res = await this.deps.fetchFn(url, { signal: AbortSignal.timeout(10_000) });
      if (res.status === 200) {
        const body = (await res.json()) as unknown;
        if (Array.isArray(body) && Array.isArray(body[1])) {
          suggestions = body[1].filter((x): x is string => typeof x === 'string');
          ok = true;
        }
      }
    } catch {
      ok = false;
    }
    if (ok) {
      this.consecutiveFailures = 0;
      return suggestions;
    }
    this.consecutiveFailures++;
    if (this.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      throw new AppError(
        'RATE_LIMITED',
        `Google Autocomplete returned ${MAX_CONSECUTIVE_FAILURES} consecutive non-200 responses (rate_limited)`,
        { httpStatus: 429, retryable: false },
      );
    }
    return [];
  }
}

/** "People Also Ask" vía SerpAPI (opcional; requiere SERPAPI_KEY). Un fallo aquí no aborta el descubrimiento. */
export class SerpApiPaaProvider implements KeywordProvider {
  readonly name = 'paa';

  constructor(
    private readonly apiKey: string,
    private readonly deps: HttpDeps = defaultHttpDeps,
    private readonly onError: (msg: string) => void = () => undefined,
  ) {}

  /** Tras un 401/403 (clave inválida o sin créditos) no se insiste: se avisa una vez y se omite. */
  private disabled = false;

  async expand(seed: string, ctx: ExpandContext): Promise<KeywordCandidate[]> {
    if (this.disabled) return [];
    const url =
      'https://serpapi.com/search.json?engine=google' +
      `&q=${encodeURIComponent(seed)}&hl=${encodeURIComponent(ctx.language)}&gl=${encodeURIComponent(ctx.country)}` +
      `&api_key=${encodeURIComponent(this.apiKey)}`;
    try {
      const res = await this.deps.fetchFn(url, { signal: AbortSignal.timeout(20_000) });
      if (res.status !== 200) {
        if (res.status === 401 || res.status === 403) this.disabled = true;
        this.onError(
          `SerpAPI responded ${res.status}${this.disabled ? ' (disabled for this run; check SERPAPI_KEY)' : ''}`,
        );
        return [];
      }
      const body = (await res.json()) as { related_questions?: { question?: string }[] };
      return (body.related_questions ?? [])
        .map((q) => normalizeTerm(q.question ?? ''))
        .filter((t) => t.length >= 2)
        .map((term) => ({ term, source: 'paa' as const, seedTerm: seed }));
    } catch (err) {
      this.onError(err instanceof Error ? err.message : String(err));
      return [];
    }
  }
}
