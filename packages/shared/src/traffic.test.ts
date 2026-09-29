import { describe, expect, it } from 'vitest';
import { aiAssistant, referrerHost, trafficChannel } from './traffic.js';

describe('trafficChannel', () => {
  it('distingue Google, asistentes de IA, buscadores, redes, directo y referencias', () => {
    expect(trafficChannel('google.es')).toBe('google');
    expect(trafficChannel('utm:google')).toBe('google');
    expect(trafficChannel('gemini.google.com')).toBe('ai');
    expect(trafficChannel('chatgpt.com')).toBe('ai');
    expect(trafficChannel('utm:chatgpt.com')).toBe('ai');
    expect(trafficChannel('perplexity.ai')).toBe('ai');
    expect(trafficChannel('bing.com')).toBe('search');
    expect(trafficChannel('m.facebook.com')).toBe('social');
    expect(trafficChannel('l.instagram.com')).toBe('social');
    expect(trafficChannel('')).toBe('direct');
    expect(trafficChannel('otroblog.es')).toBe('referral');
    expect(trafficChannel('other')).toBe('referral');
  });
  it('nombra al asistente y extrae el dominio de una URL', () => {
    expect(aiAssistant('chat.openai.com')).toBe('ChatGPT');
    expect(aiAssistant('google.es')).toBeNull();
    expect(referrerHost('https://www.Google.es/search?q=x')).toBe('google.es');
    expect(referrerHost('nada')).toBe('');
  });
});
