import type { Site } from '@seo/db';
import {
  DEFAULT_SETTINGS,
  PLATFORMS,
  parseSettings,
  planFor,
  type ConnectionTestDto,
  type CreateSiteInput,
  type EnqueuedDto,
  type UpdateSiteInput,
} from '@seo/shared';
import { createAdapter, readCredentials } from '../adapters/factory.js';
import { decryptJson, encryptJson, type SiteCredentials } from '../crypto.js';
import { AppError } from '../errors.js';
import { requireSite } from '../tenant.js';
import { normalizeSiteUrl } from '../url.js';
import type { CoreDeps } from './deps.js';

export function listSites(deps: CoreDeps, organizationId: string): Promise<Site[]> {
  return deps.prisma.site.findMany({ where: { organizationId }, orderBy: { createdAt: 'asc' } });
}

export async function createSite(
  deps: CoreDeps,
  organizationId: string,
  input: CreateSiteInput,
): Promise<Site> {
  if (!PLATFORMS[input.platform].available) {
    throw new AppError(
      'PLATFORM_NOT_SUPPORTED',
      `Platform ${input.platform} is not available yet`,
      {
        httpStatus: 400,
      },
    );
  }
  await assertSiteLimit(deps, organizationId);
  const url = normalizeSiteUrl(input.url, { allowPrivate: deps.config.allowPrivateHosts });
  const credentials: SiteCredentials = {
    username: input.wpUsername,
    appPassword: input.wpAppPassword,
  };
  const site = await deps.prisma.site.create({
    data: {
      organizationId,
      name: input.name,
      url,
      platform: input.platform,
      language: input.language,
      country: input.country,
      credentials: encryptJson(deps.encryptionKey, credentials),
      settings: { ...DEFAULT_SETTINGS, onboarding: 'pending' } as never,
    },
  });
  // Primer resultado cuanto antes: voz de marca y keywords ya; al acabar discover se redacta el
  // primer artículo (ver pipeline/onboarding.ts). Si la cola no está disponible, el alta sigue siendo
  // válida y el usuario puede lanzarlo a mano.
  try {
    await deps.dispatcher.enqueue('brand-voice', { siteId: site.id });
    await deps.dispatcher.enqueue('discover', { siteId: site.id });
  } catch {
    // CONNECTION_FAILED al encolar: ya quedó anotado en el JobRun.
  }
  return site;
}

/** Lanza PLAN_SITE_LIMIT si el plan de la organización no admite otra tienda. */
async function assertSiteLimit(deps: CoreDeps, organizationId: string): Promise<void> {
  const org = await deps.prisma.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { plan: true, _count: { select: { sites: true } } },
  });
  const max = planFor(org.plan).maxSites;
  if (max !== null && org._count.sites >= max) {
    throw new AppError('PLAN_SITE_LIMIT', `Plan ${org.plan} allows ${max} site(s)`, {
      httpStatus: 402,
    });
  }
}

export async function updateSite(
  deps: CoreDeps,
  organizationId: string,
  siteId: string,
  input: UpdateSiteInput,
): Promise<Site> {
  const site = await requireSite(deps.prisma, organizationId, siteId);
  const data: Record<string, unknown> = {};
  if (input.name !== undefined) data['name'] = input.name;
  if (input.language !== undefined) data['language'] = input.language;
  if (input.country !== undefined) data['country'] = input.country;
  if (input.brandVoice !== undefined) data['brandVoice'] = input.brandVoice;
  if (input.active !== undefined) data['active'] = input.active;
  if (input.url !== undefined) {
    data['url'] = normalizeSiteUrl(input.url, { allowPrivate: deps.config.allowPrivateHosts });
  }
  if (input.wpUsername !== undefined || input.wpAppPassword !== undefined) {
    const current = readCredentials(site.credentials, deps.encryptionKey);
    const username = input.wpUsername ?? current?.username;
    const appPassword = input.wpAppPassword ?? current?.appPassword;
    if (!username || !appPassword) {
      throw new AppError(
        'VALIDATION_ERROR',
        'Username and application password are both required',
        {
          httpStatus: 400,
        },
      );
    }
    data['credentials'] = encryptJson(deps.encryptionKey, { username, appPassword });
    // Credenciales nuevas: el estado de Yoast ya no es fiable.
  }
  if (input.settings) {
    const merged = { ...parseSettings(site.settings), ...input.settings };
    if (data['credentials']) merged.yoastMetaExposed = null;
    data['settings'] = merged;
  }
  return deps.prisma.site.update({ where: { id: site.id }, data });
}

export async function deleteSite(
  deps: CoreDeps,
  organizationId: string,
  siteId: string,
): Promise<void> {
  const site = await requireSite(deps.prisma, organizationId, siteId);
  await deps.prisma.site.delete({ where: { id: site.id } });
}

export async function testSiteConnection(
  deps: CoreDeps,
  organizationId: string,
  siteId: string,
): Promise<ConnectionTestDto> {
  const site = await requireSite(deps.prisma, organizationId, siteId);
  if (!readCredentials(site.credentials, deps.encryptionKey)) {
    return { ok: false, message: 'NO_CREDENTIALS', warnings: [] };
  }
  const adapter = createAdapter(site, {
    encryptionKey: deps.encryptionKey,
    allowPrivateHosts: deps.config.allowPrivateHosts,
    fetchFn: deps.fetchFn,
  });
  const result = await adapter.testConnection();
  const d = result.details;
  if (result.ok && d) {
    const settings = parseSettings(site.settings);
    const next = {
      ...settings,
      ...(d.yoastMetaExposed !== null ? { yoastMetaExposed: d.yoastMetaExposed } : {}),
      ...(d.seoPlugin !== null || d.yoastActive !== null ? { seoPlugin: d.seoPlugin } : {}),
      ...(d.woocommerce !== null ? { woocommerce: d.woocommerce } : {}),
      connectorVersion: d.connectorVersion,
    };
    if (JSON.stringify(next) !== JSON.stringify(settings)) {
      await deps.prisma.site.update({ where: { id: site.id }, data: { settings: next } });
    }
  }
  return {
    ok: result.ok,
    message: result.message,
    details: result.details,
    warnings: result.warnings ?? [],
  };
}

export async function analyzeVoice(
  deps: CoreDeps,
  organizationId: string,
  siteId: string,
): Promise<EnqueuedDto> {
  const site = await requireSite(deps.prisma, organizationId, siteId);
  if (!readCredentials(site.credentials, deps.encryptionKey)) {
    throw new AppError('NO_CREDENTIALS', 'Site has no credentials', { httpStatus: 400 });
  }
  return deps.dispatcher.enqueue('brand-voice', { siteId: site.id });
}

export async function discoverKeywords(
  deps: CoreDeps,
  organizationId: string,
  siteId: string,
): Promise<EnqueuedDto> {
  const site = await requireSite(deps.prisma, organizationId, siteId);
  // Sin seeds, discover las deduce del contenido de la tienda: para eso necesita leerla.
  if (
    parseSettings(site.settings).seeds.length === 0 &&
    !readCredentials(site.credentials, deps.encryptionKey)
  ) {
    throw new AppError('NO_CREDENTIALS', 'Site has no credentials to read its content', {
      httpStatus: 400,
    });
  }
  return deps.dispatcher.enqueue('discover', { siteId: site.id });
}

/** Solo para uso interno del worker/tests: descifra credenciales de un sitio. */
export function decryptSiteCredentials(
  deps: Pick<CoreDeps, 'encryptionKey'>,
  site: Site,
): SiteCredentials {
  return decryptJson<SiteCredentials>(deps.encryptionKey, site.credentials);
}
