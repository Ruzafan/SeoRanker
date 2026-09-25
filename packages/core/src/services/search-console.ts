import type {
  EnqueuedDto,
  SearchConsolePropertyDto,
  SearchConsoleStatusDto,
  SelectPropertyInput,
} from '@seo/shared';
import { decryptJson, encryptJson } from '../crypto.js';
import { AppError } from '../errors.js';
import { GoogleClient, matchProperty, type GoogleConfig } from '../integrations/google.js';
import { requireSite } from '../tenant.js';
import type { CoreDeps } from './deps.js';

const STATE_TTL_MS = 15 * 60_000;

interface OAuthState {
  userId: string;
  siteId: string;
  exp: number;
}

function requireGoogle(deps: CoreDeps): { config: GoogleConfig; client: GoogleClient } {
  const config = deps.config.google;
  if (!config) {
    throw new AppError('GOOGLE_NOT_CONFIGURED', 'Google OAuth is not configured', {
      httpStatus: 503,
    });
  }
  return { config, client: new GoogleClient(config, deps.fetchFn) };
}

async function requireConnection(deps: CoreDeps, siteId: string) {
  const conn = await deps.prisma.searchConsoleConnection.findUnique({ where: { siteId } });
  if (!conn) {
    throw new AppError('GSC_NOT_CONNECTED', 'Search Console is not connected', { httpStatus: 409 });
  }
  return conn;
}

function refreshTokenOf(deps: CoreDeps, credentials: string): string {
  return decryptJson<{ refreshToken: string }>(deps.encryptionKey, credentials).refreshToken;
}

export async function getSearchConsoleStatus(
  deps: CoreDeps,
  organizationId: string,
  siteId: string,
): Promise<SearchConsoleStatusDto> {
  const site = await requireSite(deps.prisma, organizationId, siteId);
  const conn = await deps.prisma.searchConsoleConnection.findUnique({ where: { siteId: site.id } });
  return {
    configured: !!deps.config.google,
    connected: !!conn,
    googleEmail: conn?.googleEmail ?? null,
    propertyUrl: conn?.propertyUrl ?? null,
    lastSyncAt: conn?.lastSyncAt?.toISOString() ?? null,
    lastError: conn?.lastError ?? null,
  };
}

/** URL de consentimiento de Google. El `state` va cifrado y autenticado (AES-GCM) y caduca. */
export async function startGoogleConnect(
  deps: CoreDeps,
  organizationId: string,
  userId: string,
  siteId: string,
): Promise<{ url: string }> {
  // El sitio primero: un recurso ajeno es 404 aunque Google no esté configurado.
  const site = await requireSite(deps.prisma, organizationId, siteId);
  const { client } = requireGoogle(deps);
  const state: OAuthState = { userId, siteId: site.id, exp: Date.now() + STATE_TTL_MS };
  return { url: client.authUrl(encryptJson(deps.encryptionKey, state)) };
}

/**
 * Vuelta de Google: valida el state (mismo usuario, no caducado), guarda el refresh token cifrado,
 * elige la propiedad que cubre la URL del sitio y lanza la primera sincronización.
 */
export async function completeGoogleConnect(
  deps: CoreDeps,
  organizationId: string,
  userId: string,
  rawState: string,
  code: string,
): Promise<{ siteId: string }> {
  const { client } = requireGoogle(deps);
  let state: OAuthState;
  try {
    state = decryptJson<OAuthState>(deps.encryptionKey, rawState);
  } catch {
    throw new AppError('VALIDATION_ERROR', 'Invalid OAuth state', { httpStatus: 400 });
  }
  if (state.userId !== userId || state.exp < Date.now()) {
    throw new AppError('VALIDATION_ERROR', 'Expired or foreign OAuth state', { httpStatus: 400 });
  }
  const site = await requireSite(deps.prisma, organizationId, state.siteId);

  const { refreshToken, email } = await client.exchangeCode(code);
  const properties = await client.listProperties(await client.accessToken(refreshToken));
  const propertyUrl = matchProperty(
    site.url,
    properties.map((p) => p.siteUrl),
  );
  const credentials = encryptJson(deps.encryptionKey, { refreshToken });

  const previous = await deps.prisma.searchConsoleConnection.findUnique({
    where: { siteId: site.id },
  });
  await deps.prisma.searchConsoleConnection.upsert({
    where: { siteId: site.id },
    create: { siteId: site.id, credentials, googleEmail: email, propertyUrl },
    update: {
      credentials,
      googleEmail: email,
      propertyUrl,
      lastError: null,
      // Otra propiedad = otros datos: se vuelve a leer el histórico completo.
      ...(previous?.propertyUrl !== propertyUrl ? { lastSyncAt: null } : {}),
    },
  });
  if (propertyUrl)
    await deps.dispatcher.enqueue('sync', { siteId: site.id }).catch(() => undefined);
  return { siteId: site.id };
}

export async function listSearchConsoleProperties(
  deps: CoreDeps,
  organizationId: string,
  siteId: string,
): Promise<SearchConsolePropertyDto[]> {
  const site = await requireSite(deps.prisma, organizationId, siteId);
  const { client } = requireGoogle(deps);
  const conn = await requireConnection(deps, site.id);
  const token = await client.accessToken(refreshTokenOf(deps, conn.credentials));
  return client.listProperties(token);
}

export async function selectSearchConsoleProperty(
  deps: CoreDeps,
  organizationId: string,
  siteId: string,
  input: SelectPropertyInput,
): Promise<SearchConsoleStatusDto> {
  const properties = await listSearchConsoleProperties(deps, organizationId, siteId);
  if (!properties.some((p) => p.siteUrl === input.propertyUrl)) {
    throw new AppError('VALIDATION_ERROR', 'The Google account has no access to that property', {
      httpStatus: 400,
    });
  }
  const conn = await requireConnection(deps, siteId);
  if (conn.propertyUrl !== input.propertyUrl) {
    await deps.prisma.$transaction([
      deps.prisma.searchConsoleConnection.update({
        where: { id: conn.id },
        data: { propertyUrl: input.propertyUrl, lastSyncAt: null, lastError: null },
      }),
      deps.prisma.articleMetric.deleteMany({ where: { siteId } }),
    ]);
    await deps.dispatcher.enqueue('sync', { siteId }).catch(() => undefined);
  }
  return getSearchConsoleStatus(deps, organizationId, siteId);
}

/** Desconecta: revoca el token en Google (mejor esfuerzo) y borra la conexión y sus métricas. */
export async function disconnectSearchConsole(
  deps: CoreDeps,
  organizationId: string,
  siteId: string,
): Promise<void> {
  const site = await requireSite(deps.prisma, organizationId, siteId);
  const conn = await deps.prisma.searchConsoleConnection.findUnique({ where: { siteId: site.id } });
  if (!conn) return;
  if (deps.config.google) {
    try {
      await new GoogleClient(deps.config.google, deps.fetchFn).revoke(
        refreshTokenOf(deps, conn.credentials),
      );
    } catch {
      // El token ya no era válido: nada que revocar.
    }
  }
  await deps.prisma.$transaction([
    deps.prisma.searchConsoleConnection.delete({ where: { id: conn.id } }),
    deps.prisma.articleMetric.deleteMany({ where: { siteId: site.id } }),
  ]);
}

/** Sincronización a demanda (posts, Search Console y pedidos). */
export async function syncSiteNow(
  deps: CoreDeps,
  organizationId: string,
  siteId: string,
): Promise<EnqueuedDto> {
  const site = await requireSite(deps.prisma, organizationId, siteId);
  return deps.dispatcher.enqueue('sync', { siteId: site.id });
}
