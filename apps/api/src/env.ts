import { z } from 'zod';
import { parseEncryptionKey } from '@seo/core';

/** "" → undefined: un .env con `ADMIN_EMAIL=` vacío cuenta como no definida. */
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
    API_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    API_HOST: z.string().min(1).default('0.0.0.0'),
    WEB_ORIGIN: z.string().url(),
    JWT_SECRET: z.string().min(32, 'JWT_SECRET debe tener al menos 32 caracteres'),
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
    REGISTRATION_ENABLED: z.preprocess(emptyToUndefined, bool.default(true)),
    ADMIN_EMAIL: z.preprocess(emptyToUndefined, z.string().email().optional()),
    /** Por defecto true en producción. Ponlo a false solo para probar por http en un VPS sin TLS. */
    COOKIE_SECURE: z.preprocess(emptyToUndefined, bool.optional()),
    /** Permite sitios en localhost/IP privada. Por defecto solo fuera de producción. */
    ALLOW_PRIVATE_HOSTS: z.preprocess(emptyToUndefined, bool.optional()),
    FREE_PLAN_MAX_ARTICLES: z.coerce.number().int().min(0).default(3),
    LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(10),
    // Stripe (opcional): sin STRIPE_SECRET_KEY el panel funciona sin pagos. Si se define, van todas.
    STRIPE_SECRET_KEY: z.preprocess(emptyToUndefined, z.string().startsWith('sk_').optional()),
    STRIPE_WEBHOOK_SECRET: z.preprocess(
      emptyToUndefined,
      z.string().startsWith('whsec_').optional(),
    ),
    STRIPE_PRICE_STARTER: z.preprocess(
      emptyToUndefined,
      z.string().startsWith('price_').optional(),
    ),
    STRIPE_PRICE_PRO: z.preprocess(emptyToUndefined, z.string().startsWith('price_').optional()),
    STRIPE_PRICE_AGENCY: z.preprocess(emptyToUndefined, z.string().startsWith('price_').optional()),
    STRIPE_AUTOMATIC_TAX: z.preprocess(emptyToUndefined, bool.default(false)),
    // Search Console (opcional): cliente OAuth "Aplicación web" de Google Cloud.
    GOOGLE_CLIENT_ID: z.preprocess(emptyToUndefined, z.string().optional()),
    GOOGLE_CLIENT_SECRET: z.preprocess(emptyToUndefined, z.string().optional()),
  })
  .superRefine((e, ctx) => {
    if (!!e.GOOGLE_CLIENT_ID !== !!e.GOOGLE_CLIENT_SECRET) {
      ctx.addIssue({
        code: 'custom',
        path: ['GOOGLE_CLIENT_SECRET'],
        message: 'GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET van juntas',
      });
    }
    if (!e.STRIPE_SECRET_KEY) return;
    for (const key of [
      'STRIPE_WEBHOOK_SECRET',
      'STRIPE_PRICE_STARTER',
      'STRIPE_PRICE_PRO',
      'STRIPE_PRICE_AGENCY',
    ] as const) {
      if (!e[key]) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: 'obligatoria cuando STRIPE_SECRET_KEY está definida',
        });
      }
    }
  })
  .transform((e) => ({
    ...e,
    COOKIE_SECURE: e.COOKIE_SECURE ?? e.NODE_ENV === 'production',
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
