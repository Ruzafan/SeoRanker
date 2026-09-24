import type { PrismaClient } from '@seo/db';
import type { JobDispatcher } from '../queue.js';

export interface CoreDeps {
  prisma: PrismaClient;
  dispatcher: JobDispatcher;
  encryptionKey: Buffer;
  config: {
    allowPrivateHosts: boolean;
    freePlanMaxArticles: number;
  };
  fetchFn?: typeof fetch | undefined;
}
