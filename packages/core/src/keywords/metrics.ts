import { AppError } from '../errors.js';
import { normalizeTerm, type ExpandContext } from './provider.js';

export interface KeywordMetrics {
  volume: number | null;
  difficulty: number | null;
  cpc: number | null;
}

/** Punto de extensión: métricas de mercado de keywords (volumen, dificultad, CPC). */
export interface KeywordMetricsProvider {
  readonly name: string;
  /** Mapa término normalizado → métricas. Los términos sin datos no aparecen. */
  getMetrics(terms: string[], ctx: ExpandContext): Promise<Map<string, KeywordMetrics>>;
}

/** Códigos de ubicación de Google Ads que usa DataForSEO, por país ISO. */
export const DATAFORSEO_LOCATIONS: Record<string, number> = {
  ES: 2724,
  MX: 2484,
  AR: 2032,
  CO: 2170,
  CL: 2152,
  PE: 2604,
  US: 2840,
  GB: 2826,
  FR: 2250,
  DE: 2276,
  IT: 2380,
  PT: 2620,
  BR: 2076,
  NL: 2528,
  BE: 2056,
};

const BATCH = 700;

interface OverviewItem {
  keyword?: string;
  keyword_info?: { search_volume?: number | null; cpc?: number | null };
  keyword_properties?: { keyword_difficulty?: number | null };
}

/**
 * DataForSEO Labs (keyword_overview): volumen mensual, CPC y dificultad 0-100 de hasta 700
 * keywords por petición. Requiere DATAFORSEO_LOGIN y DATAFORSEO_PASSWORD.
 */
export class DataForSeoProvider implements KeywordMetricsProvider {
  readonly name = 'dataforseo';

  constructor(
    private readonly login: string,
    private readonly password: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async getMetrics(terms: string[], ctx: ExpandContext): Promise<Map<string, KeywordMetrics>> {
    const out = new Map<string, KeywordMetrics>();
    const location = DATAFORSEO_LOCATIONS[ctx.country.toUpperCase()];
    if (!location || !terms.length) return out;
    for (let i = 0; i < terms.length; i += BATCH) {
      const batch = terms.slice(i, i + BATCH);
      const items = await this.request(batch, location, ctx.language);
      for (const item of items) {
        if (!item.keyword) continue;
        const d = item.keyword_properties?.keyword_difficulty;
        out.set(normalizeTerm(item.keyword), {
          volume: item.keyword_info?.search_volume ?? null,
          difficulty: typeof d === 'number' ? Math.round(d) : null,
          cpc: item.keyword_info?.cpc ?? null,
        });
      }
    }
    return out;
  }

  private async request(
    keywords: string[],
    location: number,
    language: string,
  ): Promise<OverviewItem[]> {
    let res: Response;
    try {
      res = await this.fetchFn(
        'https://api.dataforseo.com/v3/dataforseo_labs/google/keyword_overview/live',
        {
          method: 'POST',
          headers: {
            Authorization: `Basic ${Buffer.from(`${this.login}:${this.password}`).toString('base64')}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify([{ keywords, location_code: location, language_code: language }]),
          signal: AbortSignal.timeout(60_000),
        },
      );
    } catch (err) {
      throw new AppError('CONNECTION_FAILED', 'Could not reach DataForSEO', {
        httpStatus: 502,
        retryable: true,
        cause: err,
      });
    }
    const body = (await res.json().catch(() => null)) as {
      status_code?: number;
      status_message?: string;
      tasks?: {
        status_code?: number;
        status_message?: string;
        result?: { items?: OverviewItem[] }[];
      }[];
    } | null;
    const task = body?.tasks?.[0];
    if (!res.ok || body?.status_code !== 20000 || task?.status_code !== 20000) {
      throw new AppError(
        'CONNECTION_FAILED',
        `DataForSEO: ${res.status} ${task?.status_message ?? body?.status_message ?? ''}`.trim(),
        { httpStatus: 502, retryable: res.status >= 500 },
      );
    }
    return task.result?.flatMap((r) => r.items ?? []) ?? [];
  }
}

/**
 * Demanda 0-100 a partir de volumen y dificultad: más búsquedas suman (escala logarítmica),
 * más dificultad resta. null si no hay volumen.
 */
export function demandScore(m: KeywordMetrics): number | null {
  if (m.volume === null) return null;
  const volume = Math.min(100, 22 * Math.log10(m.volume + 1));
  const ease = m.difficulty === null ? 0.8 : 1 - m.difficulty / 130;
  return Math.max(0, Math.min(100, Math.round(volume * ease)));
}

/** Puntuación final: el criterio de Claude (encaje con el negocio) pesa más que la demanda. */
export function blendScore(aiScore: number, m: KeywordMetrics | undefined): number {
  const demand = m ? demandScore(m) : null;
  return demand === null ? aiScore : Math.round(0.6 * aiScore + 0.4 * demand);
}
