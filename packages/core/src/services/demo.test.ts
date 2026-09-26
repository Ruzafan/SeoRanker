import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearDemoCache, runDemo } from './demo.js';

const json = (b: unknown) => new Response(JSON.stringify(b));

describe('demo pública', () => {
  beforeEach(() => clearDemoCache());

  it('WooCommerce: categorías → preguntas de Autocomplete, primero las preguntas, con caché', async () => {
    const fetchFn = vi.fn(async (u: string | URL | Request) => {
      const url = String(u);
      if (url.includes('/wp/v2/product_cat'))
        return json([
          { name: 'Figuras de resina', slug: 'figuras-resina' },
          { name: 'Sin categoría', slug: 'sin-categoria' },
        ]);
      if (url.startsWith('https://tienda.es') && !url.includes('wp-json'))
        return new Response('<title>Tienda Figuras | Coleccionismo</title><h1>Hola</h1>');
      if (url.includes('suggestqueries')) {
        const q = new URL(url).searchParams.get('q') ?? '';
        return json([q, [`${q} baratas`, 'figuras', `${q} opiniones`]]);
      }
      return new Response('{}', { status: 404 });
    });
    const deps = {
      fetchFn: fetchFn as unknown as typeof fetch,
      allowPrivateHosts: true,
      sleep: async () => undefined,
    };
    const r = await runDemo(deps, 'tienda.es');
    expect(r).toMatchObject({
      url: 'https://tienda.es',
      siteName: 'Tienda Figuras',
      platform: 'woocommerce',
      topics: ['figuras de resina'],
    });
    expect(r.keywords[0]?.question).toBe(true);
    expect(r.keywords.every((k) => k.term.includes(' '))).toBe(true);
    expect(r.keywords.length).toBeLessThanOrEqual(12);
    const calls = fetchFn.mock.calls.length;
    await runDemo(deps, 'https://tienda.es/');
    expect(fetchFn.mock.calls.length).toBe(calls); // caché por dominio
  });

  it('web sin WordPress: temas desde los encabezados; sin temas → NO_SEEDS', async () => {
    const page = (html: string) =>
      vi.fn(async (u: string | URL | Request) => {
        const url = String(u);
        if (url.includes('wp-json')) return new Response('nope', { status: 404 });
        if (url.includes('suggestqueries')) return json(['q', ['cómo elegir velas aromáticas']]);
        return new Response(html);
      });
    const ok = await runDemo(
      {
        fetchFn: page(
          '<h2>Velas aromáticas</h2><h2>Un encabezado demasiado largo para ser un tema de verdad</h2>',
        ) as unknown as typeof fetch,
        allowPrivateHosts: true,
        sleep: async () => undefined,
      },
      'velas.es',
    );
    expect(ok).toMatchObject({ platform: 'unknown', topics: ['velas aromáticas'] });
    await expect(
      runDemo(
        { fetchFn: page('<p>nada</p>') as unknown as typeof fetch, allowPrivateHosts: true },
        'vacia.es',
      ),
    ).rejects.toMatchObject({ code: 'NO_SEEDS' });
  });

  it('rechaza destinos privados cuando no están permitidos', async () => {
    await expect(runDemo({ allowPrivateHosts: false }, 'http://127.0.0.1')).rejects.toMatchObject({
      code: 'INVALID_URL',
    });
  });
});
