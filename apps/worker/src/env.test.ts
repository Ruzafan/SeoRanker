import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { loadEnv } from './env.js';

const valid = {
  DATABASE_URL: 'postgresql://a:b@localhost:5432/x',
  REDIS_URL: 'redis://localhost:6379',
  ANTHROPIC_API_KEY: 'sk-ant-test',
  ENCRYPTION_KEY: randomBytes(32).toString('base64'),
};

describe('loadEnv (worker)', () => {
  it('falla si falta ANTHROPIC_API_KEY o ENCRYPTION_KEY', () => {
    expect(() => loadEnv({ DATABASE_URL: valid.DATABASE_URL, REDIS_URL: valid.REDIS_URL })).toThrow(
      /ANTHROPIC_API_KEY[\s\S]*ENCRYPTION_KEY/,
    );
  });
  it('rechaza una ENCRYPTION_KEY que no mide 32 bytes', () => {
    expect(() => loadEnv({ ...valid, ENCRYPTION_KEY: randomBytes(8).toString('base64') })).toThrow(
      /32 bytes/,
    );
  });
  it('acepta un entorno completo y aplica defaults', () => {
    const e = loadEnv({ ...valid, SERPAPI_KEY: '', DEFAULT_MODEL: '' });
    expect(e.DEFAULT_MODEL).toBe('claude-sonnet-5');
    expect(e.SERPAPI_KEY).toBeUndefined();
    expect(e.ALLOW_PRIVATE_HOSTS).toBe(true);
    expect(loadEnv({ ...valid, NODE_ENV: 'production' }).ALLOW_PRIVATE_HOSTS).toBe(false);
  });
});
