import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';

/**
 * Base de datos dedicada para tests de integración (una por paquete para poder correr en paralelo).
 * Devuelve null si Postgres no está disponible: los tests que la necesitan se saltan con aviso.
 * Configurable con TEST_DATABASE_ADMIN_URL (por defecto el Postgres de docker-compose).
 */
export async function setupTestDatabase(
  name: string,
): Promise<{ prisma: PrismaClient; url: string } | null> {
  const adminUrl =
    process.env['TEST_DATABASE_ADMIN_URL'] ?? 'postgresql://seo:seo@localhost:5432/postgres';
  const dbName = `seo_test_${name.replace(/\W/g, '_')}`;
  const url = adminUrl.replace(/\/[^/?]*(\?|$)/, `/${dbName}$1`);

  const admin = new PrismaClient({ datasourceUrl: adminUrl });
  try {
    const rows = await admin.$queryRawUnsafe<{ exists: boolean }[]>(
      `SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = '${dbName}') AS exists`,
    );
    if (!rows[0]?.exists) await admin.$executeRawUnsafe(`CREATE DATABASE "${dbName}"`);
  } catch {
    console.warn(
      `[tests] Postgres no disponible en ${adminUrl}: se saltan los tests de integración`,
    );
    return null;
  } finally {
    await admin.$disconnect();
  }

  execSync('pnpm exec prisma migrate deploy', {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'ignore',
  });
  return { prisma: new PrismaClient({ datasourceUrl: url }), url };
}

export async function resetDatabase(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe(
    'TRUNCATE "AiVisibilityCheck","ArticleComment","Invitation","InternalLink","KeywordCluster","ArticleConversion","ArticleMetric","SearchConsoleConnection","UsageRecord","JobRun","Article","Keyword","Site","User","Organization" CASCADE',
  );
}
