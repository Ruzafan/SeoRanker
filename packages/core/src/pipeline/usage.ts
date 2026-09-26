import type { PrismaClient } from '@seo/db';
import { estimateCostCents } from '../ai/pricing.js';
import type { TokenUsage } from '../ai/claude.js';

export function currentPeriod(now: Date = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

export interface UsageDelta {
  articles?: number;
  inputTokens?: number;
  outputTokens?: number;
  costCents?: number;
}

export async function recordUsage(
  prisma: Pick<PrismaClient, 'usageRecord'>,
  siteId: string,
  delta: UsageDelta,
  now: Date = new Date(),
): Promise<void> {
  const period = currentPeriod(now);
  const inc = {
    articles: delta.articles ?? 0,
    inputTokens: delta.inputTokens ?? 0,
    outputTokens: delta.outputTokens ?? 0,
    costCents: delta.costCents ?? 0,
  };
  await prisma.usageRecord.upsert({
    where: { siteId_period: { siteId, period } },
    create: { siteId, period, ...inc },
    update: {
      articles: { increment: inc.articles },
      inputTokens: { increment: inc.inputTokens },
      outputTokens: { increment: inc.outputTokens },
      costCents: { increment: inc.costCents },
    },
  });
}

/**
 * Acumula el consumo de un trabajo. Cada llamada a Claude se persiste al instante en UsageRecord
 * (el dinero gastado cuenta aunque el trabajo falle después) y los totales van al JobRun.
 */
export class UsageTracker {
  inputTokens = 0;
  outputTokens = 0;
  costCents = 0;
  readonly models = new Set<string>();

  constructor(
    private readonly prisma: Pick<PrismaClient, 'usageRecord'>,
    private readonly siteId: string,
  ) {}

  async add(model: string, usage: TokenUsage): Promise<void> {
    const costCents = estimateCostCents(model, usage);
    this.inputTokens += usage.inputTokens;
    this.outputTokens += usage.outputTokens;
    this.costCents += costCents;
    this.models.add(model);
    await recordUsage(this.prisma, this.siteId, { ...usage, costCents });
  }

  /** Coste que no son tokens (p. ej. búsquedas web: 1 céntimo de dólar por búsqueda). */
  async addCost(costCents: number): Promise<void> {
    if (costCents <= 0) return;
    this.costCents += costCents;
    await recordUsage(this.prisma, this.siteId, { costCents });
  }

  toMeta(): Record<string, unknown> {
    return {
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      costCents: this.costCents,
      models: [...this.models],
    };
  }
}
