import { describe, expect, it } from 'vitest';
import { healthResponseSchema } from './health.js';

describe('healthResponseSchema', () => {
  it('acepta una respuesta válida', () => {
    const parsed = healthResponseSchema.parse({ status: 'ok', checks: { db: 'ok', redis: 'ok' } });
    expect(parsed.status).toBe('ok');
  });
  it('rechaza estados desconocidos', () => {
    expect(() =>
      healthResponseSchema.parse({ status: 'meh', checks: { db: 'ok', redis: 'ok' } }),
    ).toThrow();
  });
});
