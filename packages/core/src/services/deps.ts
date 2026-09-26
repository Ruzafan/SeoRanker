import type { PrismaClient } from '@seo/db';
import type { GoogleConfig } from '../integrations/google.js';
import type { JobDispatcher } from '../queue.js';
import type { Billing } from './billing.js';

export interface CoreDeps {
  prisma: PrismaClient;
  dispatcher: JobDispatcher;
  encryptionKey: Buffer;
  config: {
    allowPrivateHosts: boolean;
    freePlanMaxArticles: number;
    /** OAuth de Google para Search Console; undefined = GOOGLE_NOT_CONFIGURED. */
    google?: GoogleConfig | undefined;
  };
  fetchFn?: typeof fetch | undefined;
  /** Stripe; undefined si el servidor no lo tiene configurado (BILLING_NOT_CONFIGURED). */
  billing?: Billing | undefined;
}
