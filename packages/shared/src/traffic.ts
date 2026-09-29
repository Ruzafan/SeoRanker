/** Canales de procedencia de una visita o un pedido. */
export const TRAFFIC_CHANNELS = ['google', 'ai', 'search', 'social', 'referral', 'direct'] as const;
export type TrafficChannel = (typeof TRAFFIC_CHANNELS)[number];

/** Asistentes de IA por dominio (o utm_source) de procedencia. */
const AI_ASSISTANTS: Record<string, string> = {
  'chatgpt.com': 'ChatGPT',
  'chat.openai.com': 'ChatGPT',
  'openai.com': 'ChatGPT',
  chatgpt: 'ChatGPT',
  'perplexity.ai': 'Perplexity',
  perplexity: 'Perplexity',
  'claude.ai': 'Claude',
  'gemini.google.com': 'Gemini',
  'bard.google.com': 'Gemini',
  'copilot.microsoft.com': 'Copilot',
  'deepseek.com': 'DeepSeek',
  'meta.ai': 'Meta AI',
  'you.com': 'You.com',
  'chat.mistral.ai': 'Mistral',
  'grok.com': 'Grok',
  'poe.com': 'Poe',
};
const SEARCH_ENGINES = [
  'bing.com',
  'duckduckgo.com',
  'yahoo.com',
  'ecosia.org',
  'yandex.ru',
  'yandex.com',
  'baidu.com',
  'search.brave.com',
  'qwant.com',
  'startpage.com',
];
const SOCIAL = [
  'facebook.com',
  'fb.com',
  'instagram.com',
  't.co',
  'x.com',
  'twitter.com',
  'pinterest.com',
  'linkedin.com',
  'lnkd.in',
  'reddit.com',
  'youtube.com',
  'tiktok.com',
  'whatsapp.com',
  't.me',
  'threads.net',
];

const matches = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`);

/** Nombre del asistente de IA de una procedencia, o null si no es un asistente. */
export function aiAssistant(source: string): string | null {
  const v = source.replace(/^utm:/, '').toLowerCase();
  const hit = Object.keys(AI_ASSISTANTS).find((d) => matches(v, d));
  return hit ? (AI_ASSISTANTS[hit] ?? null) : null;
}

/**
 * Canal de una procedencia tal como la guarda el conector: dominio de referencia sin www,
 * `utm:<utm_source>`, '' (sin referencia = directo) u `other`.
 */
export function trafficChannel(source: string): TrafficChannel {
  const v = source.replace(/^utm:/, '').toLowerCase();
  if (v === '') return 'direct';
  if (aiAssistant(v)) return 'ai';
  if (v === 'google' || /(^|\.)google\.[a-z.]+$/.test(v)) return 'google';
  if (v === 'bing' || SEARCH_ENGINES.some((d) => matches(v, d))) return 'search';
  if (['facebook', 'instagram', 'twitter', 'linkedin', 'pinterest', 'tiktok'].includes(v))
    return 'social';
  if (SOCIAL.some((d) => matches(v, d))) return 'social';
  return 'referral';
}

/** Dominio de una URL de referencia, sin www; '' si no hay o no es válida. */
export function referrerHost(url: string): string {
  const m = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/?#]*@)?([^/:?#]+)/i.exec(url.trim());
  return m?.[1] ? m[1].toLowerCase().replace(/^www\./, '') : '';
}
