import type { ConnectionDetails, WarningCode } from '@seo/shared';

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
}

export interface ConnectionResult {
  ok: boolean;
  /** "OK" o un código de error (WP_AUTH_FAILED, CONNECTION_FAILED…). */
  message: string;
  details?: ConnectionDetails;
  warnings?: WarningCode[];
}

export interface PublishingAdapter {
  testConnection(): Promise<ConnectionResult>;
  listContent(limit: number): Promise<ContentItem[]>;
  getSamples(limit: number): Promise<ContentSample[]>;
  /** Nombres de categorías (de producto primero), las más usadas antes. Para deducir seeds. */
  listCategories(limit: number): Promise<string[]>;
  createPost(
    input: CreatePostInput,
  ): Promise<{ id: number; url: string; warnings?: WarningCode[] }>;
  updatePost(
    id: number,
    input: Partial<CreatePostInput>,
  ): Promise<{ warnings?: WarningCode[] } | void>;
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
}

export { WordPressAdapter, type WordPressAdapterOptions } from './wordpress.js';
export { ShopifyAdapter } from './shopify.js';
