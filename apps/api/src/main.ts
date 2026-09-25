import { Redis } from 'ioredis';
import {
  BullDispatcher,
  createQueues,
  createStripeBilling,
  parseEncryptionKey,
  redisConnectionFromUrl,
} from '@seo/core';
import { getPrisma } from '@seo/db';
import { buildApp } from './app.js';
import { loadEnv } from './env.js';

async function main(): Promise<void> {
  const env = loadEnv();
  const prisma = getPrisma();
  const redis = new Redis(env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 });
  redis.on('error', () => undefined); // el estado se reporta en /health, no como excepción

  const queues = createQueues(redisConnectionFromUrl(env.REDIS_URL));
  for (const q of Object.values(queues)) q.on('error', () => undefined);

  const billing =
    env.STRIPE_SECRET_KEY &&
    env.STRIPE_WEBHOOK_SECRET &&
    env.STRIPE_PRICE_STARTER &&
    env.STRIPE_PRICE_PRO &&
    env.STRIPE_PRICE_AGENCY
      ? createStripeBilling(env.STRIPE_SECRET_KEY, {
          webhookSecret: env.STRIPE_WEBHOOK_SECRET,
          prices: {
            starter: env.STRIPE_PRICE_STARTER,
            pro: env.STRIPE_PRICE_PRO,
            agency: env.STRIPE_PRICE_AGENCY,
          },
          webOrigin: env.WEB_ORIGIN,
          automaticTax: env.STRIPE_AUTOMATIC_TAX,
        })
      : undefined;

  const app = await buildApp({
    env,
    core: {
      prisma,
      dispatcher: new BullDispatcher(prisma, queues),
      encryptionKey: parseEncryptionKey(env.ENCRYPTION_KEY),
      config: {
        allowPrivateHosts: env.ALLOW_PRIVATE_HOSTS,
        freePlanMaxArticles: env.FREE_PLAN_MAX_ARTICLES,
      },
      billing,
    },
    boardQueues: Object.values(queues),
    health: {
      db: async () => {
        await prisma.$queryRaw`SELECT 1`;
      },
      redis: async () => {
        if (redis.status === 'wait') await redis.connect();
        await redis.ping();
      },
    },
  });

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'shutting down');
    await app.close();
    await Promise.all(Object.values(queues).map((q) => q.close()));
    await prisma.$disconnect();
    redis.disconnect();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ port: env.API_PORT, host: env.API_HOST });
}

main().catch((err: unknown) => {
  // Aún no hay logger si falla el env: stderr directo.
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
