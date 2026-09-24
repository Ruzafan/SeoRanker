import type { TokenUsage } from './claude.js';

/** USD por millón de tokens. ESTIMACIÓN: revisa https://www.anthropic.com/pricing y ajusta. */
interface Rate {
  input: number;
  output: number;
}

const RATES: { match: RegExp; rate: Rate }[] = [
  { match: /opus/i, rate: { input: 15, output: 75 } },
  { match: /haiku/i, rate: { input: 1, output: 5 } },
  { match: /sonnet|fable/i, rate: { input: 3, output: 15 } },
];
const FALLBACK: Rate = { input: 3, output: 15 };

/** Coste en céntimos de dólar, redondeado hacia arriba (mínimo 1 si hubo consumo). */
export function estimateCostCents(model: string, usage: TokenUsage): number {
  const rate = RATES.find((r) => r.match.test(model))?.rate ?? FALLBACK;
  const usd = (usage.inputTokens * rate.input + usage.outputTokens * rate.output) / 1_000_000;
  const cents = usd * 100;
  return cents <= 0 ? 0 : Math.max(1, Math.ceil(cents));
}
