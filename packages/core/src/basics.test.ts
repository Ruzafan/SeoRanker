import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decryptJson, encryptJson, parseEncryptionKey } from './crypto.js';
import { countWords, extractLinks, sanitizeArticleHtml, slugify, truncateAtWord } from './html.js';
import { hashPassword, verifyPassword } from './password.js';
import { estimateCostCents } from './ai/pricing.js';
import { isPrivateIp, normalizeSiteUrl } from './url.js';
import { maxTokensFor } from './pipeline/write.js';

describe('crypto AES-256-GCM', () => {
  const key = randomBytes(32);
  it('cifra y descifra', () => {
    const payload = encryptJson(key, { username: 'a', appPassword: 'b c d' });
    expect(payload).not.toContain('appPassword');
    expect(decryptJson(key, payload)).toEqual({ username: 'a', appPassword: 'b c d' });
  });
  it('rechaza una clave distinta y datos manipulados', () => {
    const payload = encryptJson(key, { x: 1 });
    expect(() => decryptJson(randomBytes(32), payload)).toThrow();
    const parts = payload.split('.');
    parts[3] = Buffer.from('tampered').toString('base64');
    expect(() => decryptJson(key, parts.join('.'))).toThrow();
  });
  it('exige 32 bytes', () => {
    expect(() => parseEncryptionKey(randomBytes(16).toString('base64'))).toThrow(/32 bytes/);
    expect(parseEncryptionKey(randomBytes(32).toString('base64'))).toHaveLength(32);
  });
});

describe('normalizeSiteUrl', () => {
  it('añade https y quita barra final', () => {
    expect(normalizeSiteUrl('mitienda.es/', { allowPrivate: false })).toBe('https://mitienda.es');
    expect(normalizeSiteUrl('https://x.com/blog/?a=1#h', { allowPrivate: false })).toBe(
      'https://x.com/blog',
    );
  });
  it.each([
    'http://localhost',
    'http://127.0.0.1',
    'http://10.0.0.5',
    'http://192.168.1.1',
    'http://169.254.169.254',
    'http://[::1]',
    'http://foo.internal',
  ])('rechaza %s en producción', (u) => {
    expect(() => normalizeSiteUrl(u, { allowPrivate: false })).toThrow(/Private|local/i);
  });
  it('permite privadas si se autoriza (desarrollo)', () => {
    expect(normalizeSiteUrl('http://localhost:8888', { allowPrivate: true })).toBe(
      'http://localhost:8888',
    );
  });
  it('rechaza esquemas raros y credenciales', () => {
    expect(() => normalizeSiteUrl('ftp://x.com', { allowPrivate: false })).toThrow();
    expect(() => normalizeSiteUrl('https://u:p@x.com', { allowPrivate: false })).toThrow();
  });
  it('isPrivateIp', () => {
    expect(isPrivateIp('172.20.1.1')).toBe(true);
    expect(isPrivateIp('8.8.8.8')).toBe(false);
    expect(isPrivateIp('fd00::1')).toBe(true);
  });
});

describe('sanitizeArticleHtml', () => {
  it('elimina scripts, atributos y h1', () => {
    const out = sanitizeArticleHtml(
      '<h1 onclick="x">T</h1><script>alert(1)</script><p style="x">Hola <a href="javascript:alert(1)">m</a></p>',
    );
    expect(out).not.toContain('script');
    expect(out).not.toContain('<h1');
    expect(out).not.toContain('onclick');
    expect(out).not.toContain('javascript');
    expect(out).toContain('<h2>T</h2>');
  });
  it('solo conserva enlaces de la lista permitida', () => {
    const html = '<p><a href="https://s.com/a">ok</a> y <a href="https://otro.com/x">no</a></p>';
    const out = sanitizeArticleHtml(html, new Set(['https://s.com/a']));
    expect(extractLinks(out)).toEqual(['https://s.com/a']);
    expect(out).toContain('no');
    expect(out).not.toContain('otro.com');
  });
  it('cuenta palabras', () => {
    expect(countWords('<h2>Uno dos</h2><p>tres <strong>cuatro</strong></p>')).toBe(4);
  });
  it('slugify y truncate', () => {
    expect(slugify('Cómo coleccionar Figuras Ñandú!')).toBe('como-coleccionar-figuras-nandu');
    expect(truncateAtWord('uno dos tres cuatro cinco', 14)).toBe('uno dos tres');
  });
});

describe('password argon2id', () => {
  it('hash y verificación', async () => {
    const h = await hashPassword('correcto-horse-battery');
    expect(h).toMatch(/^\$argon2id\$/);
    expect(await verifyPassword(h, 'correcto-horse-battery')).toBe(true);
    expect(await verifyPassword(h, 'otra')).toBe(false);
  });
});

describe('cálculos', () => {
  it('max_tokens = palabras*4+1500 con techo 16000', () => {
    expect(maxTokensFor(1200)).toBe(6300);
    expect(maxTokensFor(5000)).toBe(16_000);
  });
  it('coste estimado', () => {
    expect(estimateCostCents('claude-sonnet-5', { inputTokens: 0, outputTokens: 0 })).toBe(0);
    // 100k in * $2/M + 10k out * $10/M = $0.30
    expect(
      estimateCostCents('claude-sonnet-5', { inputTokens: 100_000, outputTokens: 10_000 }),
    ).toBe(30);
    // Opus 5: $5/$25 → $0.75; Fable 5.1: $10/$50 → $1.50
    expect(estimateCostCents('claude-opus-5', { inputTokens: 100_000, outputTokens: 10_000 })).toBe(
      75,
    );
    expect(
      estimateCostCents('claude-fable-5-1', { inputTokens: 100_000, outputTokens: 10_000 }),
    ).toBe(150);
  });
});
