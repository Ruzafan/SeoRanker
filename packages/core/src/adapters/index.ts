import type { ConnectionDetails, WarningCode } from '@seo/shared';

export interface CreatePostInput {
  title: string;
  content: string;
  slug?: string;
  status: 'draft' | 'publish';
  excerpt?: string;
  categoryId?: number | null;
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
}

export { WordPressAdapter, type WordPressAdapterOptions } from './wordpress.js';
export { ShopifyAdapter } from './shopify.js';
