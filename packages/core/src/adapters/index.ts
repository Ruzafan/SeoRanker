import type { ConnectionDetails, ProductSnapshot, WarningCode } from '@seo/shared';

export interface CreatePostInput {
  title: string;
  content: string;
  slug?: string;
  status: 'draft' | 'publish';
  excerpt?: string;
  categoryId?: number | null;
  /** Usuario de WordPress que firma el post (E-E-A-T). */
  authorId?: number | null;
  featuredMediaId?: number | null;
  seo?: {
    focusKeyword?: string;
    metaDescription?: string;
    title?: string;
    /** JSON-LD del artículo; lo imprime el conector en el <head>. */
    schemaJson?: string;
  };
}

export interface ContentItem {
  id: number;
  title: string;
  url: string;
  type: string;
}

export interface ContentSample {
  title: string;
  body: string;
  type: string;
}

/** Producto de la tienda que un artículo puede recomendar. */
export interface StoreProduct {
  id: number;
  name: string;
  url: string;
  /** Precio formateado con su moneda, p. ej. "49,90 EUR"; null si no se conoce. */
  price: string | null;
  /** ID de medio de su imagen principal (sirve de imagen destacada del artículo). */
  imageId: number | null;
}

export interface Author {
  id: number;
  name: string;
}

/** Estado actual de un post en WordPress (la URL cambia de ?p=ID a la definitiva al publicarse). */
export interface PostInfo {
  id: number;
  url: string;
  status: string;
}

/** Pedido con la página en la que empezó la sesión del cliente (atribución de WooCommerce). */
export interface AttributedOrder {
  id: string;
  total: number;
  currency: string;
  createdAt: string;
  entry: string;
  sourceType: string;
  /** URL de referencia de la visita (vacía si fue directa). */
  referrer?: string;
  /** utm_source de la visita (conector 1.2.0+). */
  utmSource?: string;
}

/** Visitas que entraron por un post, por día (YYYY-MM-DD) y procedencia (conector 1.2.0+). */
export interface PostVisits {
  postId: number;
  date: string;
  source: string;
  visits: number;
}

/** Cambio en un campo de un producto; `expected` es el valor que debe tener aún en la tienda. */
export interface ProductChange {
  field: string;
  value: string | string[];
  expected: string | string[];
}

export interface ConnectionResult {
  ok: boolean;
  /** "OK" o un código de error (WP_AUTH_FAILED, CONNECTION_FAILED…). */
  message: string;
  details?: ConnectionDetails;
  warnings?: WarningCode[];
}

/** Lo que se lee del sitio para analizarlo; lo cumple cualquier plataforma (ver crawler.ts). */
export interface SiteReader {
  listContent(limit: number): Promise<ContentItem[]>;
  getSamples(limit: number): Promise<ContentSample[]>;
  /** Nombres de categorías (de producto primero), las más usadas antes. Para deducir seeds. */
  listCategories(limit: number): Promise<string[]>;
}

export interface PublishingAdapter extends SiteReader {
  testConnection(): Promise<ConnectionResult>;
  createPost(
    input: CreatePostInput,
  ): Promise<{ id: number; url: string; warnings?: WarningCode[] }>;
  updatePost(
    id: number,
    input: Partial<CreatePostInput>,
  ): Promise<{ url?: string; warnings?: WarningCode[] } | void>;
  /** Productos de la tienda que encajan con `query` (WooCommerce); [] si no hay tienda. */
  searchProducts(query: string, limit: number): Promise<StoreProduct[]>;
  /** Usuarios que pueden firmar artículos. */
  listAuthors(): Promise<Author[]>;
  /** Estado y URL de los posts indicados (los borrados no aparecen). */
  getPostsInfo(ids: number[]): Promise<PostInfo[]>;
  /** Pedidos desde `after`; null si la tienda no lo soporta (sin WooCommerce o conector antiguo). */
  listAttributedOrders(
    after: Date,
    page: number,
  ): Promise<{ orders: AttributedOrder[]; hasMore: boolean } | null>;
  /** Visitas desde `after` (YYYY-MM-DD); null si el conector no las cuenta. */
  listVisits(after: string): Promise<PostVisits[] | null>;
  /** Productos publicados (50 por página, o los `ids` indicados); null sin conector 1.3.0+. */
  listProducts(
    page: number,
    ids?: number[],
  ): Promise<{ products: ProductSnapshot[]; hasMore: boolean } | null>;
  /** Aplica cambios a un producto (todo o nada). PRODUCT_CHANGED si algo cambió en la tienda. */
  updateProduct(id: number, changes: ProductChange[]): Promise<ProductSnapshot>;
}

export { WordPressAdapter, type WordPressAdapterOptions } from './wordpress.js';
export { ShopifyAdapter } from './shopify.js';
export { CrawlerReader, type CrawlerReaderOptions } from './crawler.js';
