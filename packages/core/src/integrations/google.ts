import { AppError } from '../errors.js';

/** Solo lectura de Search Console, más el email de la cuenta para mostrar cuál está conectada. */
export const GSC_SCOPES = [
  'https://www.googleapis.com/auth/webmasters.readonly',
  'openid',
  'email',
];

export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
  /** URL pública del callback: `${WEB_ORIGIN}/api/v1/integrations/google/callback`. */
  redirectUri: string;
}

export interface SearchAnalyticsRow {
  keys: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface SearchAnalyticsQuery {
  startDate: string;
  endDate: string;
  dimensions: ('date' | 'page' | 'query')[];
  rowLimit?: number;
  startRow?: number;
}

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GSC_BASE = 'https://www.googleapis.com/webmasters/v3';

/** Cliente mínimo de OAuth de Google y de la API de Search Console, con fetch inyectable. */
export class GoogleClient {
  private readonly fetchFn: typeof fetch;

  constructor(
    private readonly config: GoogleConfig,
    fetchFn?: typeof fetch,
  ) {
    this.fetchFn = fetchFn ?? fetch;
  }

  authUrl(state: string): string {
    const p = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      response_type: 'code',
      scope: GSC_SCOPES.join(' '),
      access_type: 'offline',
      // Sin prompt=consent Google no vuelve a dar refresh token si ya se autorizó antes.
      prompt: 'consent',
      include_granted_scopes: 'true',
      state,
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${p.toString()}`;
  }

  async exchangeCode(code: string): Promise<{ refreshToken: string; email: string | null }> {
    const body = await this.tokenRequest({
      code,
      grant_type: 'authorization_code',
      redirect_uri: this.config.redirectUri,
    });
    const refreshToken = typeof body['refresh_token'] === 'string' ? body['refresh_token'] : null;
    if (!refreshToken) {
      throw new AppError('GOOGLE_AUTH_FAILED', 'Google did not return a refresh token', {
        httpStatus: 400,
      });
    }
    return { refreshToken, email: emailFromIdToken(body['id_token']) };
  }

  async accessToken(refreshToken: string): Promise<string> {
    const body = await this.tokenRequest({
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    });
    const token = body['access_token'];
    if (typeof token !== 'string') {
      throw new AppError('GOOGLE_AUTH_FAILED', 'Google returned no access token', {
        httpStatus: 400,
      });
    }
    return token;
  }

  async revoke(refreshToken: string): Promise<void> {
    await this.fetchFn(
      `https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(refreshToken)}`,
      {
        method: 'POST',
        signal: AbortSignal.timeout(10_000),
      },
    ).catch(() => undefined);
  }

  async listProperties(
    accessToken: string,
  ): Promise<{ siteUrl: string; permissionLevel: string }[]> {
    const res = await this.api<{ siteEntry?: { siteUrl: string; permissionLevel: string }[] }>(
      accessToken,
      `${GSC_BASE}/sites`,
    );
    return (res.siteEntry ?? []).filter((s) => s.permissionLevel !== 'siteUnverifiedUser');
  }

  /** Pagina sola hasta `maxRows`. Las fechas son YYYY-MM-DD (zona horaria del Pacífico, como GSC). */
  async searchAnalytics(
    accessToken: string,
    property: string,
    query: SearchAnalyticsQuery,
    maxRows = 25_000,
  ): Promise<SearchAnalyticsRow[]> {
    const pageSize = Math.min(query.rowLimit ?? 25_000, 25_000);
    const rows: SearchAnalyticsRow[] = [];
    for (let startRow = query.startRow ?? 0; rows.length < maxRows; startRow += pageSize) {
      const res = await this.api<{ rows?: SearchAnalyticsRow[] }>(
        accessToken,
        `${GSC_BASE}/sites/${encodeURIComponent(property)}/searchAnalytics/query`,
        { ...query, rowLimit: pageSize, startRow },
      );
      const batch = res.rows ?? [];
      rows.push(...batch);
      if (batch.length < pageSize) break;
    }
    return rows.slice(0, maxRows);
  }

  private async tokenRequest(params: Record<string, string>): Promise<Record<string, unknown>> {
    let res: Response;
    try {
      res = await this.fetchFn(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: this.config.clientId,
          client_secret: this.config.clientSecret,
          ...params,
        }).toString(),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      throw new AppError('CONNECTION_FAILED', 'Could not reach Google', {
        httpStatus: 502,
        retryable: true,
        cause: err,
      });
    }
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      // invalid_grant = el usuario revocó el acceso o el token caducó: hay que reconectar.
      throw new AppError(
        'GOOGLE_AUTH_FAILED',
        `Google token endpoint: ${res.status} ${String(body['error'] ?? '')}`.trim(),
        { httpStatus: 400, retryable: res.status >= 500 },
      );
    }
    return body;
  }

  private async api<T>(accessToken: string, url: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchFn(url, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (err) {
      throw new AppError('CONNECTION_FAILED', 'Could not reach Search Console', {
        httpStatus: 502,
        retryable: true,
        cause: err,
      });
    }
    if (res.ok) return (await res.json()) as T;
    const detail = await res.text().catch(() => '');
    if (res.status === 401 || res.status === 403) {
      throw new AppError(
        'GOOGLE_AUTH_FAILED',
        `Search Console ${res.status}: ${detail.slice(0, 200)}`,
        {
          httpStatus: 400,
        },
      );
    }
    throw new AppError(
      'CONNECTION_FAILED',
      `Search Console ${res.status}: ${detail.slice(0, 200)}`,
      {
        httpStatus: 502,
        retryable: res.status === 429 || res.status >= 500,
      },
    );
  }
}

/** El id_token llega directamente de Google por TLS: basta con leer su payload. */
function emailFromIdToken(idToken: unknown): string | null {
  if (typeof idToken !== 'string') return null;
  const payload = idToken.split('.')[1];
  if (!payload) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      email?: unknown;
    };
    return typeof data.email === 'string' ? data.email : null;
  } catch {
    return null;
  }
}

/** Clave comparable de una URL: sin protocolo, sin www, sin query/hash y sin barra final. */
export function urlKey(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    const path = decodeURIComponent(u.pathname).replace(/\/+$/, '');
    return `${host}${path}`;
  } catch {
    return url.trim().toLowerCase();
  }
}

/**
 * Elige la propiedad de Search Console que cubre la URL del sitio: primero la de dominio
 * (sc-domain:), después el prefijo de URL más largo que la contenga.
 */
export function matchProperty(siteUrl: string, properties: string[]): string | null {
  let host: string;
  try {
    host = new URL(siteUrl).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
  const domain = properties.find((p) => p.toLowerCase() === `sc-domain:${host}`);
  if (domain) return domain;
  const key = urlKey(siteUrl);
  return (
    properties
      .filter((p) => !p.startsWith('sc-domain:') && key.startsWith(urlKey(p)))
      .sort((a, b) => b.length - a.length)[0] ?? null
  );
}
