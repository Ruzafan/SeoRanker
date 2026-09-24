import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { AppError } from './errors.js';

export function isPrivateIp(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const [a = 0, b = 0] = ip.split('.').map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  if (v === 6) {
    const l = ip.toLowerCase();
    if (l === '::1' || l === '::') return true;
    if (l.startsWith('::ffff:')) return isPrivateIp(l.slice(7));
    return (
      l.startsWith('fc') ||
      l.startsWith('fd') ||
      l.startsWith('fe8') ||
      l.startsWith('fe9') ||
      l.startsWith('fea') ||
      l.startsWith('feb')
    );
  }
  return false;
}

function isPrivateHostname(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    h === 'localhost' ||
    h.endsWith('.localhost') ||
    h.endsWith('.local') ||
    h.endsWith('.internal')
  ) {
    return true;
  }
  return isIP(h) !== 0 && isPrivateIp(h);
}

export interface NormalizeOptions {
  allowPrivate: boolean;
}

/** Normaliza la URL de un sitio (https por defecto, sin barra final) y rechaza destinos privados. */
export function normalizeSiteUrl(input: string, { allowPrivate }: NormalizeOptions): string {
  const raw = /^[a-z][a-z0-9+.-]*:\/\//i.test(input.trim())
    ? input.trim()
    : `https://${input.trim()}`;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new AppError('INVALID_URL', 'Invalid URL', { httpStatus: 400 });
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new AppError('INVALID_URL', 'Only http(s) URLs are allowed', { httpStatus: 400 });
  }
  if (url.username || url.password) {
    throw new AppError('INVALID_URL', 'Credentials in URL are not allowed', { httpStatus: 400 });
  }
  if (!allowPrivate && isPrivateHostname(url.hostname)) {
    throw new AppError('INVALID_URL', 'Private or local hosts are not allowed', {
      httpStatus: 400,
    });
  }
  url.hash = '';
  url.search = '';
  return url.toString().replace(/\/+$/, '');
}

/** Comprobación en el momento de la petición: el DNS podría apuntar a una IP privada (SSRF). */
export async function assertPublicDestination(rawUrl: string): Promise<void> {
  const { hostname } = new URL(rawUrl);
  if (isPrivateHostname(hostname)) {
    throw new AppError('INVALID_URL', 'Private or local hosts are not allowed', {
      httpStatus: 400,
    });
  }
  if (isIP(hostname)) return;
  try {
    const records = await lookup(hostname, { all: true });
    if (records.some((r) => isPrivateIp(r.address))) {
      throw new AppError('INVALID_URL', 'Host resolves to a private address', { httpStatus: 400 });
    }
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError('CONNECTION_FAILED', `DNS lookup failed for ${hostname}`, {
      httpStatus: 502,
      retryable: true,
      cause: err,
    });
  }
}
