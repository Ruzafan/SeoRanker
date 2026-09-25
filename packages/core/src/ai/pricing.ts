import type { TokenUsage } from './claude.js';

/** USD por millón de tokens (tarifas públicas de Anthropic, septiembre de 2026). */
interface Rate {
  input: number;
  output: number;
}

// El orden importa: gana la primera coincidencia (las versiones concretas antes que la familia).
const RATES: { match: RegExp; rate: Rate }[] = [
  { match: /fable|mythos/i, rate: { input: 10, output: 50 } },
  { match: /opus-5-5/i, rate: { input: 4, output: 20 } },
  { match: /opus-(5|4-[5-9])/i, rate: { input: 5, output: 25 } },
  { match: /opus/i, rate: { input: 15, output: 75 } },
  { match: /sonnet-5/i, rate: { input: 2, output: 10 } },
  { match: /sonnet/i, rate: { input: 3, output: 15 } },
  { match: /haiku/i, rate: { input: 1, output: 5 } },
];
const FALLBACK: Rate = { input: 5, output: 25 };

/** Coste en céntimos de dólar, redondeado hacia arriba (mínimo 1 si hubo consumo). */
export function estimateCostCents(model: string, usage: TokenUsage): number {
  const rate = RATES.find((r) => r.match.test(model))?.rate ?? FALLBACK;
  const usd = (usage.inputTokens * rate.input + usage.outputTokens * rate.output) / 1_000_000;
  const cents = usd * 100;
  return cents <= 0 ? 0 : Math.max(1, Math.ceil(cents));
}
