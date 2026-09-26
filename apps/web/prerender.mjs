// Prerender de las páginas públicas tras `vite build`: HTML indexable con <head> propio por página,
// sitemap.xml y robots.txt. El panel sigue siendo una SPA servida desde app.html.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, 'dist');
const ssr = join(here, 'dist-ssr');
const site = (process.env.PUBLIC_SITE_URL || 'https://seoranker.tech').replace(/\/+$/, '');

const { render, PUBLIC_PAGES } = await import(pathToFileURL(join(ssr, 'entry-server.js')).href);
const template = readFileSync(join(dist, 'index.html'), 'utf8');

// Shell del panel: la plantilla sin contenido. nginx la sirve para cualquier ruta no prerenderizada.
writeFileSync(join(dist, 'app.html'), template);

const esc = (s) =>
  String(s).replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c],
  );
// JSON dentro de <script>: sin "</" para que no pueda cerrar la etiqueta.
const ld = (obj) => JSON.stringify(obj).replace(/</g, '\\u003c');

for (const page of PUBLIC_PAGES) {
  const url = `${site}${page.path === '/' ? '/' : page.path}`;
  const head = [
    `<title>${esc(page.title)}</title>`,
    `<meta name="description" content="${esc(page.description)}" />`,
    `<link rel="canonical" href="${esc(url)}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="SEO Autopilot" />`,
    `<meta property="og:title" content="${esc(page.title)}" />`,
    `<meta property="og:description" content="${esc(page.description)}" />`,
    `<meta property="og:url" content="${esc(url)}" />`,
    `<meta property="og:locale" content="es_ES" />`,
    `<meta name="twitter:card" content="summary" />`,
    ...(page.jsonLd ?? []).map((j) => `<script type="application/ld+json">${ld(j)}</script>`),
  ].join('\n    ');
  const html = template
    .replace(/<title>[\s\S]*?<\/title>/, '')
    .replace(/<meta\s+name="description"[\s\S]*?\/>/, head)
    .replace('<div id="root"></div>', `<div id="root">${render(page.path)}</div>`);
  if (!html.includes('rel="canonical"'))
    throw new Error(`Prerender: no se pudo insertar el <head> en ${page.path}`);
  const out = page.path === '/' ? join(dist, 'index.html') : join(dist, page.path, 'index.html');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, html);
}

const today = new Date().toISOString().slice(0, 10);
writeFileSync(
  join(dist, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${PUBLIC_PAGES.map(
    (p) => `  <url><loc>${site}${p.path}</loc><lastmod>${today}</lastmod></url>`,
  ).join('\n')}\n</urlset>\n`,
);
writeFileSync(
  join(dist, 'robots.txt'),
  [
    'User-agent: *',
    'Disallow: /app',
    'Disallow: /sites',
    'Disallow: /billing',
    'Disallow: /admin',
    'Disallow: /api/',
    'Disallow: /login',
    'Disallow: /invite/',
    'Disallow: /organization',
    '',
    `Sitemap: ${site}/sitemap.xml`,
    '',
  ].join('\n'),
);
rmSync(ssr, { recursive: true, force: true });
console.log(`prerender: ${PUBLIC_PAGES.length} páginas, sitemap y robots para ${site}`);
