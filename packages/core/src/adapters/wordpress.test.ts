import { describe, expect, it, vi } from 'vitest';
import { WordPressAdapter } from './wordpress.js';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function adapter(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const fetchFn = vi.fn(async (u: string | URL | Request, init?: RequestInit) =>
    handler(String(u), init ?? {}),
  );
  return {
    fetchFn,
    wp: new WordPressAdapter({
      baseUrl: 'https://tienda.es/',
      username: 'admin',
      appPassword: 'abcd efgh ijkl',
      allowPrivateHosts: true,
      fetchFn: fetchFn as unknown as typeof fetch,
    }),
  };
}

describe('WordPressAdapter', () => {
  it('testConnection OK detecta Yoast y meta no expuesta', async () => {
    const { wp, fetchFn } = adapter((url) => {
      if (url.endsWith('/wp-json/')) return json({ namespaces: ['wp/v2', 'yoast/v1'] });
      if (url.includes('/users/me')) return json({ name: 'Mi Tienda' });
      if (url.includes('/posts?per_page=1')) return json([{ id: 1, meta: { footnotes: '' } }]);
      return json({}, 404);
    });
    const r = await wp.testConnection();
    expect(r.ok).toBe(true);
    expect(r.details).toEqual({
      yoastActive: true,
      yoastMetaExposed: false,
      siteName: 'Mi Tienda',
    });
    expect(r.warnings).toEqual(['YOAST_META_NOT_EXPOSED']);
    const auth = (fetchFn.mock.calls[0]?.[1]?.headers as Record<string, string>)['Authorization'];
    expect(auth).toBe(`Basic ${Buffer.from('admin:abcd efgh ijkl').toString('base64')}`);
  });

  it('testConnection devuelve el código de error, no texto', async () => {
    expect((await adapter(() => json({}, 401)).wp.testConnection()).message).toBe('WP_AUTH_FAILED');
    expect((await adapter(() => json({}, 404)).wp.testConnection()).message).toBe(
      'WP_REST_NOT_FOUND',
    );
    const down = adapter(() => {
      throw new TypeError('fetch failed');
    });
    expect((await down.wp.testConnection()).message).toBe('CONNECTION_FAILED');
  });

  it('listContent junta posts, páginas y productos; sin WooCommerce no falla', async () => {
    const { wp } = adapter((url) => {
      if (url.includes('/posts?'))
        return json([{ id: 1, link: 'https://tienda.es/a', title: { rendered: 'A &amp; B' } }]);
      if (url.includes('/pages?'))
        return json([{ id: 2, link: 'https://tienda.es/p', title: { rendered: 'P' } }]);
      return json({ code: 'rest_no_route' }, 404);
    });
    const items = await wp.listContent(25);
    expect(items).toEqual([
      { id: 1, title: 'A & B', url: 'https://tienda.es/a', type: 'post' },
      { id: 2, title: 'P', url: 'https://tienda.es/p', type: 'page' },
    ]);
  });

  it('listCategories: productos primero, sin "sin categoría" ni duplicados', async () => {
    const { wp } = adapter((url) => {
      if (url.includes('/product_cat?'))
        return json([
          { name: 'Figuras &amp; estatuas', slug: 'figuras' },
          { name: 'Sin categoría', slug: 'sin-categoria' },
        ]);
      if (url.includes('/categories?'))
        return json([
          { name: 'Guías', slug: 'guias' },
          { name: 'Figuras & estatuas', slug: 'figuras-2' },
          { name: 'Uncategorized', slug: 'uncategorized' },
        ]);
      return json({}, 404);
    });
    expect(await wp.listCategories(10)).toEqual(['Figuras & estatuas', 'Guías']);

    const noWoo = adapter((url) =>
      url.includes('/categories?') ? json([{ name: 'Blog', slug: 'blog' }]) : json({}, 404),
    );
    expect(await noWoo.wp.listCategories(10)).toEqual(['Blog']);
  });

  it('createPost: crea sin meta, aplica Yoast aparte y verifica leyendo de vuelta', async () => {
    const calls: { url: string; body: unknown }[] = [];
    const { wp } = adapter((url, init) => {
      const body = init.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url, body });
      if (url.endsWith('/posts') && init.method === 'POST')
        return json({ id: 77, link: 'https://tienda.es/x' });
      if (url.endsWith('/posts/77') && init.method === 'POST') return json({ id: 77 });
      if (url.includes('/posts/77?context=edit'))
        return json({ id: 77, meta: { _yoast_wpseo_metadesc: 'desc' } });
      return json({}, 404);
    });
    const res = await wp.createPost({
      title: 'T',
      content: '<p>c</p>',
      slug: 't',
      status: 'draft',
      categoryId: 5,
      seo: { focusKeyword: 'kw', metaDescription: 'desc', title: 'T' },
    });
    expect(res).toEqual({ id: 77, url: 'https://tienda.es/x', warnings: [] });
    expect(calls[0]?.body).toEqual({
      title: 'T',
      content: '<p>c</p>',
      slug: 't',
      status: 'draft',
      categories: [5],
    });
    expect(calls[1]?.body).toEqual({
      meta: { _yoast_wpseo_focuskw: 'kw', _yoast_wpseo_metadesc: 'desc', _yoast_wpseo_title: 'T' },
    });
  });

  it('avisa (sin fallar) cuando Yoast no expone el meta por REST', async () => {
    const { wp } = adapter((url, init) => {
      if (url.endsWith('/posts') && init.method === 'POST')
        return json({ id: 9, link: 'https://tienda.es/y' });
      if (url.endsWith('/posts/9') && init.method === 'POST') return json({ id: 9 });
      if (url.includes('/posts/9?context=edit')) return json({ id: 9, meta: {} });
      return json({}, 404);
    });
    const res = await wp.createPost({
      title: 'T',
      content: 'c',
      status: 'draft',
      seo: { metaDescription: 'desc' },
    });
    expect(res.id).toBe(9);
    expect(res.warnings).toEqual(['YOAST_META_NOT_EXPOSED']);
  });

  it('bloquea destinos privados si allowPrivateHosts=false', async () => {
    const wp = new WordPressAdapter({
      baseUrl: 'http://127.0.0.1',
      username: 'a',
      appPassword: 'b',
      allowPrivateHosts: false,
      fetchFn: vi.fn() as unknown as typeof fetch,
    });
    await expect(wp.listContent(5)).rejects.toMatchObject({ code: 'INVALID_URL' });
  });
});
