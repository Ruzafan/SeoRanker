import { platformCapabilities, type PlatformCapabilities } from '@seo/shared';
import { readCredentials } from './adapters/factory.js';
import { AppError } from './errors.js';

/** Lanza PLATFORM_NOT_SUPPORTED si la plataforma del sitio no permite `capability`. */
export function assertCapability(
  site: { platform: string },
  capability: keyof PlatformCapabilities,
): void {
  if (!platformCapabilities(site.platform)[capability]) {
    throw new AppError(
      'PLATFORM_NOT_SUPPORTED',
      `Platform ${site.platform} does not support ${capability}`,
      { httpStatus: 400 },
    );
  }
}

/** Se puede leer el contenido del sitio: una web genérica se rastrea; con conector, credenciales. */
export function canReadSite(site: { platform: string; credentials: string }, key: Buffer): boolean {
  return site.platform === 'generic' || readCredentials(site.credentials, key) !== null;
}
