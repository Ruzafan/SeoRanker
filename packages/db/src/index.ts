import { PrismaClient } from '@prisma/client';

export * from '@prisma/client';

let client: PrismaClient | undefined;

/** Cliente Prisma singleton. La URL se lee de DATABASE_URL. */
export function getPrisma(): PrismaClient {
  client ??= new PrismaClient();
  return client;
}
