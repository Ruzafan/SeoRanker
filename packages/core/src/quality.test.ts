import { describe, expect, it, vi } from 'vitest';
import { applyProductCards, extractFaq, sanitizeArticleHtml } from './html.js';
import { blendScore, DataForSeoProvider, demandScore } from './keywords/metrics.js';
import { extractStructure, fetchSerp, medianWordCount } from './keywords/serp.js';
import { buildArticleSchema } from './seo/schema.js';

describe('HTML del artículo', () => {
  it('conserva tablas y sigue quitando lo no permitido', () => {
    const html = sanitizeArticleHtml(
      '<table class="x"><thead><tr><th>A</th></tr></thead><tbody><tr><td onclick="x()">1</td></tr></tbody></table><script>x</script><img src="a.png">',
    );
    expect(html).toBe(
      '<table><thead><tr><th>A</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table>',
    );
  });

  it('marcadores de producto → shortcode de WooCommerce solo para IDs ofrecidos y una vez', () => {
    const { html, productIds } = applyProductCards(
      '<p>Te recomendamos la vitrina.</p><p>[[product:12]]</p><p>[[product:99]]</p><p>Otra vez [[product:12]]</p><p>[[product:12]]</p>',
      new Set([12, 13]),
    );
    expect(productIds).toEqual([12]);
    expect(html).toBe(
      '<p>Te recomendamos la vitrina.</p>\n[products ids="12" columns="1"]\n<p>Otra vez </p>',
    );
  });

  it('extractFaq lee los pares h3 + párrafos de la última sección', () => {
    const faq = extractFaq(
      '<h2>Intro</h2><h3>No es FAQ</h3><p>texto</p><h2>Preguntas frecuentes</h2>' +
        '<h3>¿Se puede lavar?</h3><p>Sí, con agua <strong>tibia</strong>.</p><p>Y jabón neutro.</p>' +
        '<h3>¿Y con alcohol?</h3><p>No, daña la pintura.</p>',
    );
    expect(faq).toEqual([
      { question: '¿Se puede lavar?', answer: 'Sí, con agua tibia. Y jabón neutro.' },
      { question: '¿Y con alcohol?', answer: 'No, daña la pintura.' },
    ]);
  });
});

describe('JSON-LD', () => {
  const base = {
    title: 'Cómo limpiar figuras',
    description: 'Guía',
    url: 'https://t.es/limpiar/',
    siteName: 'Tienda',
    siteUrl: 'https://t.es',
    language: 'es',
    publishedAt: null,
    updatedAt: new Date('2026-09-01T00:00:00Z'),
  };
  const faq = [
    { question: '¿A?', answer: 'Respuesta A.' },
    { question: '¿B?', answer: 'Respuesta B.' },
  ];
  it('FAQPage siempre que haya 2+ preguntas; Article solo sin plugin SEO', () => {
    const withPlugin = JSON.parse(buildArticleSchema({ ...base, faq, includeArticle: false })!);
    expect(withPlugin['@graph'].map((n: { '@type': string }) => n['@type'])).toEqual(['FAQPage']);
    expect(withPlugin['@graph'][0].mainEntity[1]).toEqual({
      '@type': 'Question',
      name: '¿B?',
      acceptedAnswer: { '@type': 'Answer', text: 'Respuesta B.' },
    });
    const bare = JSON.parse(buildArticleSchema({ ...base, faq: [], includeArticle: true })!);
    expect(bare['@graph'][0]).toMatchObject({
      '@type': 'Article',
      headline: 'Cómo limpiar figuras',
    });
    expect(
      buildArticleSchema({ ...base, faq: faq.slice(0, 1), includeArticle: false }),
    ).toBeUndefined();
  });
});

describe('SERP', () => {
  it('extractStructure ignora navegación y scripts', () => {
    const s = extractStructure(
      '<nav><h2>Menú</h2></nav><script>var h2</script><h2 class="a">Qué es</h2><p>uno dos tres</p><h3>Detalle <b>x</b></h3><footer><h2>Pie</h2></footer>',
    );
    expect(s.headings).toEqual(['Qué es', '  Detalle x']);
    expect(s.wordCount).toBeGreaterThanOrEqual(5);
  });

  it('fetchSerp junta orgánicos, estructura de los 5 primeros, preguntas y elementos', async () => {
    const fetchFn = vi.fn(async (u: string | URL | Request) => {
      const url = String(u);
      if (url.startsWith('https://serpapi.com'))
        return new Response(
          JSON.stringify({
            organic_results: Array.from({ length: 7 }, (_, i) => ({
              position: i + 1,
              title: `R${i + 1}`,
              link: `https://c${i + 1}.com/p`,
              snippet: 's',
            })),
            related_questions: [{ question: '¿Cuánto dura?' }],
            answer_box: {},
          }),
        );
      const words = url.includes('c1') ? 900 : 1200;
      return new Response(`<h2>Sección</h2><p>${'p '.repeat(words)}</p>`, {
        headers: { 'content-type': 'text/html; charset=utf-8' },
      });
    });
    const snap = await fetchSerp(
      'k',
      'limpiar figuras',
      { language: 'es', country: 'ES' },
      {
        fetchFn: fetchFn as unknown as typeof fetch,
        allowPrivateHosts: true,
      },
    );
    expect(snap?.results).toHaveLength(7);
    expect(snap?.results[0]?.headings).toEqual(['Sección']);
    expect(snap?.results[6]?.headings).toEqual([]); // solo se leen los 5 primeros
    expect(snap?.relatedQuestions).toEqual(['¿Cuánto dura?']);
    expect(snap?.features).toEqual(['featured_snippet']);
    expect(medianWordCount(snap!)).toBeGreaterThan(1100);
    expect(String(fetchFn.mock.calls[0]?.[0])).toContain('gl=es');
  });

  it('fetchSerp devuelve null si SerpAPI falla', async () => {
    const fetchFn = vi.fn(async () => new Response('{}', { status: 401 }));
    expect(
      await fetchSerp(
        'k',
        'q',
        { language: 'es', country: 'ES' },
        {
          fetchFn: fetchFn as unknown as typeof fetch,
          allowPrivateHosts: true,
        },
      ),
    ).toBeNull();
  });
});

describe('métricas de keywords', () => {
  it('DataForSEO: petición por ubicación e idioma y lectura de volumen/dificultad/CPC', async () => {
    const fetchFn = vi.fn(async (_u: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body[0]).toMatchObject({ location_code: 2724, language_code: 'es' });
      return new Response(
        JSON.stringify({
          status_code: 20000,
          tasks: [
            {
              status_code: 20000,
              result: [
                {
                  items: [
                    {
                      keyword: 'Limpiar Figuras',
                      keyword_info: { search_volume: 880, cpc: 0.42 },
                      keyword_properties: { keyword_difficulty: 23.4 },
                    },
                  ],
                },
              ],
            },
          ],
        }),
      );
    });
    const p = new DataForSeoProvider('l', 'p', fetchFn as unknown as typeof fetch);
    const m = await p.getMetrics(['limpiar figuras'], { language: 'es', country: 'ES' });
    expect(m.get('limpiar figuras')).toEqual({ volume: 880, difficulty: 23, cpc: 0.42 });
    // País sin mapeo: no se llama.
    expect((await p.getMetrics(['x'], { language: 'es', country: 'ZZ' })).size).toBe(0);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('la demanda sube con el volumen y baja con la dificultad; mezcla 60/40 con Claude', () => {
    const easy = demandScore({ volume: 1000, difficulty: 10, cpc: null })!;
    const hard = demandScore({ volume: 1000, difficulty: 90, cpc: null })!;
    expect(easy).toBeGreaterThan(hard);
    expect(demandScore({ volume: 10, difficulty: 10, cpc: null })!).toBeLessThan(easy);
    expect(blendScore(80, undefined)).toBe(80);
    expect(blendScore(80, { volume: null, difficulty: null, cpc: null })).toBe(80);
    expect(blendScore(80, { volume: 1000, difficulty: 10, cpc: null })).toBe(
      Math.round(0.6 * 80 + 0.4 * easy),
    );
  });
});
