import { describe, expect, it } from 'vitest';
import { createSiteSchema } from './schemas.js';

const base = { name: 'Luxhome', url: 'https://www.luxhomein.com/', language: 'es', country: 'ES' };

describe('createSiteSchema', () => {
  it('una web genérica no necesita credenciales, aunque lleguen vacías del formulario', () => {
    const r = createSiteSchema.parse({
      ...base,
      platform: 'generic',
      wpUsername: '',
      wpAppPassword: ' ',
    });
    expect(r).toMatchObject({
      platform: 'generic',
      wpUsername: undefined,
      wpAppPassword: undefined,
    });
  });

  it('WordPress exige usuario y contraseña de aplicación', () => {
    const r = createSiteSchema.safeParse({ ...base, platform: 'wordpress', wpUsername: '' });
    expect(r.success).toBe(false);
    expect(r.error?.issues.map((i) => i.path.join('.')).sort()).toEqual([
      'wpAppPassword',
      'wpUsername',
    ]);
    expect(
      createSiteSchema.safeParse({ ...base, wpUsername: 'u', wpAppPassword: 'abcd efgh ijkl' })
        .success,
    ).toBe(true);
    expect(
      createSiteSchema.safeParse({ ...base, wpUsername: 'u', wpAppPassword: 'corta' }).success,
    ).toBe(false);
  });
});
