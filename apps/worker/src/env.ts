import { z } from 'zod';
import { parseEncryptionKey } from '@seo/core';

const emptyToUndefined = (v: unknown): unknown => (v === '' ? undefined : v);
const bool = z.enum(['true', 'false']).transform((v) => v === 'true');

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    DATABASE_URL: z.string().url(),
    REDIS_URL: z.string().url(),
    ANTHROPIC_API_KEY: z.string().min(1, 'ANTHROPIC_API_KEY es obligatoria'),
    DEFAULT_MODEL: z.preprocess(emptyToUndefined, z.string().min(1).default('claude-sonnet-5')),
    ENCRYPTION_KEY: z.string().superRefine((v, ctx) => {
      try {
        parseEncryptionKey(v);
      } catch (e) {
        ctx.addIssue({
          code: 'custom',
          message: e instanceof Error ? e.message : 'ENCRYPTION_KEY inválida',
        });
      }
    }),
    SERPAPI_KEY: z.preprocess(emptyToUndefined, z.string().optional()),
    FREE_PLAN_MAX_ARTICLES: z.coerce.number().int().min(0).default(10),
    ALLOW_PRIVATE_HOSTS: z.preprocess(emptyToUndefined, bool.optional()),
    WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(20).default(2),
  })
  .transform((e) => ({
    ...e,
    ALLOW_PRIVATE_HOSTS: e.ALLOW_PRIVATE_HOSTS ?? e.NODE_ENV !== 'production',
  }));

export type Env = z.infer<typeof envSchema>;

/** Valida el entorno. Si falta algo, el proceso no arranca y dice exactamente qué. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const details = result.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Variables de entorno inválidas:\n${details}`);
  }
  return result.data;
}
