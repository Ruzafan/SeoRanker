import { decryptJson, type SiteCredentials } from '../crypto.js';
import { AppError } from '../errors.js';
import { CrawlerReader } from './crawler.js';
import type { PublishingAdapter, SiteReader } from './index.js';
import { WordPressAdapter } from './wordpress.js';

export interface AdapterDeps {
  encryptionKey: Buffer;
  allowPrivateHosts: boolean;
  fetchFn?: typeof fetch | undefined;
}

export function readCredentials(encrypted: string, key: Buffer): SiteCredentials | null {
  if (!encrypted) return null;
  try {
    const creds = decryptJson<Partial<SiteCredentials>>(key, encrypted);
    return creds.username && creds.appPassword
      ? { username: creds.username, appPassword: creds.appPassword }
      : null;
  } catch {
    return null;
  }
}

export function createAdapter(
  site: { url: string; credentials: string; platform?: string },
  deps: AdapterDeps,
): PublishingAdapter {
  // Nueva plataforma: implementa su adapter, añade su caso aquí y márcala available en PLATFORMS.
  const platform = site.platform ?? 'wordpress';
  if (platform !== 'wordpress') {
    throw new AppError('PLATFORM_NOT_SUPPORTED', `No adapter for platform ${platform}`, {
      httpStatus: 400,
    });
  }
  const creds = readCredentials(site.credentials, deps.encryptionKey);
  if (!creds)
    throw new AppError('NO_CREDENTIALS', 'Site has no usable credentials', { httpStatus: 400 });
  return new WordPressAdapter({
    baseUrl: site.url,
    username: creds.username,
    appPassword: creds.appPassword,
    allowPrivateHosts: deps.allowPrivateHosts,
    fetchFn: deps.fetchFn,
  });
}

/**
 * Lo que se lee del sitio para analizarlo. Con conector, su API (más fiable); una web genérica se
 * rastrea. Una plataforma sin capacidad de publicar no necesita credenciales.
 */
export function createReader(
  site: { url: string; credentials: string; platform?: string },
  deps: AdapterDeps,
): SiteReader {
  if (site.platform === 'generic') {
    return new CrawlerReader({
      baseUrl: site.url,
      allowPrivateHosts: deps.allowPrivateHosts,
      fetchFn: deps.fetchFn,
    });
  }
  return createAdapter(site, deps);
}
