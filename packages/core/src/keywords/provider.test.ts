import { describe, expect, it, vi } from 'vitest';
import { AutocompleteProvider, questionModifiers, type HttpDeps } from './provider.js';

const ctx = { language: 'es', country: 'ES' };

function deps(fetchFn: typeof fetch): HttpDeps & { sleep: ReturnType<typeof vi.fn> } {
  return { fetchFn, sleep: vi.fn(async () => undefined), random: () => 0.5 };
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe('AutocompleteProvider', () => {
  it('hace alphabet soup + modificadores y deduplica', async () => {
    const urls: string[] = [];
    const d = deps(
      vi.fn(async (u: string | URL | Request) => {
        urls.push(String(u));
        return json(['q', ['Figuras de Acción', 'figuras   de acción', 'figuras coleccionables']]);
      }) as unknown as typeof fetch,
    );
    const out = await new AutocompleteProvider(d).expand('figuras', ctx);
    expect(urls).toHaveLength(1 + 26 + questionModifiers('es').length);
    expect(urls[0]).toContain('hl=es');
    expect(urls[0]).toContain('gl=ES');
    expect(out.map((c) => c.term).sort()).toEqual(['figuras coleccionables', 'figuras de acción']);
    expect(out[0]).toMatchObject({ source: 'autocomplete', seedTerm: 'figuras' });
  });

  it('espera 400-800 ms entre peticiones (jitter), no antes de la primera', async () => {
    const d = deps(vi.fn(async () => json(['q', []])) as unknown as typeof fetch);
    await new AutocompleteProvider(d).expand('x', ctx);
    expect(d.sleep).toHaveBeenCalledTimes(26 + questionModifiers('es').length);
    for (const call of d.sleep.mock.calls) {
      expect(call[0]).toBeGreaterThanOrEqual(400);
      expect(call[0]).toBeLessThan(800);
    }
  });

  it('aborta con RATE_LIMITED tras tres no-200 seguidos y no sigue golpeando', async () => {
    const f = vi.fn(async () => json({}, 429));
    const p = new AutocompleteProvider(deps(f as unknown as typeof fetch));
    await expect(p.expand('x', ctx)).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      retryable: false,
    });
    expect(f).toHaveBeenCalledTimes(3);
  });

  it('un 200 entre medias reinicia el contador', async () => {
    let i = 0;
    const f = vi.fn(async () => (++i % 3 === 0 ? json(['q', ['a b']]) : json({}, 500)));
    const out = await new AutocompleteProvider(deps(f as unknown as typeof fetch)).expand('x', ctx);
    expect(out.length).toBeGreaterThan(0);
  });
});
