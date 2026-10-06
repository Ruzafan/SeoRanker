import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearCrawlerCache,
  CrawlerReader,
  parsePage,
  parseRobots,
  parseSitemap,
} from './crawler.js';

type Routes = Record<string, { status?: number; body?: string; type?: string; location?: string }>;

function site(routes: Routes) {
  return vi.fn(async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const r = routes[url];
    if (!r) return new Response('not found', { status: 404 });
    const headers: Record<string, string> = {
      'content-type': r.type ?? 'text/html; charset=utf-8',
    };
    if (r.location) headers['location'] = r.location;
    return new Response(r.body ?? '', { status: r.status ?? 200, headers });
  });
}

const page = (title: string, body: string, extra = '') =>
  `<html><head><title>${title} | Clínica Sol</title>${extra}</head><body>
   <header><nav><a href="/">Inicio</a></nav></header>
   <main><h1>${title}</h1><p>${body}</p></main><footer>Aviso legal</footer></body></html>`;

const LONG =
  'Texto de ejemplo con suficiente longitud para contar como contenido real del sitio. '.repeat(3);

const reader = (fetchFn: ReturnType<typeof site>, maxPages?: number) =>
  new CrawlerReader({
    baseUrl: 'https://clinica.test',
    allowPrivateHosts: true,
    fetchFn: fetchFn as unknown as typeof fetch,
    ...(maxPages ? { maxPages } : {}),
  });

beforeEach(() => clearCrawlerCache());

describe('CrawlerReader', () => {
  it('descubre por el sitemap declarado en robots.txt y respeta Disallow', async () => {
    const fetchFn = site({
      'https://clinica.test/robots.txt': {
        type: 'text/plain',
        body: 'User-agent: *\nDisallow: /privado/\nSitemap: https://clinica.test/mapa.xml',
      },
      'https://clinica.test/mapa.xml': {
        type: 'application/xml',
        body: `<?xml version="1.0"?><urlset>
          <url><loc>https://clinica.test/servicios/implantes/</loc><lastmod>2026-01-01</lastmod></url>
          <url><loc>https://clinica.test/servicios/ortodoncia/</loc><lastmod>2026-03-01</lastmod></url>
          <url><loc>https://clinica.test/blog/como-cuidar-encias/</loc></url>
          <url><loc>https://clinica.test/privado/x/</loc></url>
          <url><loc>https://otra.test/fuera/</loc></url>
        </urlset>`,
      },
      'https://clinica.test/': { body: page('Clínica Sol', LONG, '') },
      'https://clinica.test/servicios/implantes/': { body: page('Implantes dentales', LONG) },
      'https://clinica.test/servicios/ortodoncia/': { body: page('Ortodoncia invisible', LONG) },
      'https://clinica.test/blog/como-cuidar-encias/': {
        body: page('Cómo cuidar las encías', LONG),
      },
    });
    const r = reader(fetchFn);
    const content = await r.listContent(10);
    expect(content.map((c) => c.title)).toEqual([
      'Clínica Sol',
      'Ortodoncia invisible', // lastmod más reciente primero
      'Implantes dentales',
      'Cómo cuidar las encías',
    ]);
    expect(content.find((c) => c.url.includes('/blog/'))?.type).toBe('post');
    const urls = fetchFn.mock.calls.map((c) => String(c[0]));
    expect(urls).not.toContain('https://clinica.test/privado/x/');
    expect(urls).not.toContain('https://otra.test/fuera/');

    const samples = await r.getSamples(2);
    expect(samples[0]?.type).toBe('post');
    expect(samples[0]?.body).not.toContain('Aviso legal'); // sin pie ni menú
    expect(await r.listCategories(5)).toContain('servicios');
  });

  it('sin sitemap, sigue los enlaces internos de la portada', async () => {
    const fetchFn = site({
      'https://clinica.test/': {
        body: `<html><body><main><h1>Inicio</h1><p>${LONG}</p>
          <a href="/contacto">Contacto</a><a href="https://clinica.test/equipo#top">Equipo</a>
          <a href="/logo.png">logo</a><a href="https://facebook.com/x">fb</a></main></body></html>`,
      },
      'https://clinica.test/contacto': { body: page('Contacto', LONG) },
      'https://clinica.test/equipo': { body: page('Nuestro equipo', LONG) },
    });
    const titles = (await reader(fetchFn).listContent(10)).map((c) => c.title);
    expect(titles).toEqual(['Inicio', 'Contacto', 'Nuestro equipo']);
  });

  it('omite páginas noindex y respeta el máximo de páginas', async () => {
    const urls = Array.from({ length: 10 }, (_, i) => `https://clinica.test/p${i}`);
    const routes: Routes = {
      'https://clinica.test/sitemap.xml': {
        type: 'application/xml',
        body: `<urlset>${urls.map((u) => `<url><loc>${u}</loc></url>`).join('')}</urlset>`,
      },
      'https://clinica.test/': { body: page('Inicio', LONG) },
    };
    urls.forEach((u, i) => {
      routes[u] = {
        body: page(`Página ${i}`, LONG, i === 0 ? '<meta name="robots" content="noindex">' : ''),
      };
    });
    const fetchFn = site(routes);
    const content = await reader(fetchFn, 4).listContent(20);
    expect(content).toHaveLength(3); // portada + p1, p2 (p0 es noindex)
    expect(content.map((c) => c.title)).not.toContain('Página 0');
  });

  it('lanza CONNECTION_FAILED si la portada no responde', async () => {
    await expect(reader(site({})).listContent(5)).rejects.toMatchObject({
      code: 'CONNECTION_FAILED',
    });
  });

  it('sigue redirecciones dentro del sitio', async () => {
    const fetchFn = site({
      'https://clinica.test/': { status: 301, location: 'https://www.clinica.test/' },
      'https://www.clinica.test/': { body: page('Inicio', LONG) },
    });
    const content = await reader(fetchFn).listContent(5);
    expect(content[0]?.url).toBe('https://www.clinica.test/');
  });
});

describe('parsers', () => {
  it('robots: agrupa user-agents y Allow más específico gana', () => {
    const r = parseRobots(
      'User-agent: Googlebot\nDisallow: /\n\nUser-agent: bingbot\nUser-agent: *\nDisallow: /wp-admin/\nAllow: /wp-admin/admin-ajax.php\nDisallow: /*.pdf$',
    );
    expect(r.disallows('/blog/')).toBe(false);
    expect(r.disallows('/wp-admin/x')).toBe(true);
    expect(r.disallows('/wp-admin/admin-ajax.php')).toBe(false);
    expect(r.disallows('/doc.pdf')).toBe(true);
  });

  it('sitemap: índice y urlset con CDATA', () => {
    expect(
      parseSitemap(
        '<sitemapindex><sitemap><loc>https://a.test/s1.xml</loc></sitemap></sitemapindex>',
      ),
    ).toEqual({ kind: 'index', entries: [{ loc: 'https://a.test/s1.xml' }] });
    expect(
      parseSitemap(
        '<urlset><url><loc><![CDATA[https://a.test/x?a=1&amp;b=2]]></loc></url></urlset>',
      ).entries[0]?.loc,
    ).toBe('https://a.test/x?a=1&b=2');
  });

  it('página: título sin la marca cuando no hay h1', () => {
    const p = parsePage(
      '<html><head><title>Precios de implantes – Clínica Sol</title></head><body><p>x</p></body></html>',
      'https://a.test/precios',
    );
    expect(p?.title).toBe('Precios de implantes');
  });
});
