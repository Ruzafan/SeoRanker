import type { ProductSnapshot } from '@seo/shared';
import { NotImplementedError } from '../errors.js';
import type {
  AttributedOrder,
  Author,
  StoreProduct,
  ConnectionResult,
  PostInfo,
  PostVisits,
  ProductChange,
  ContentItem,
  ContentSample,
  CreatePostInput,
  PublishingAdapter,
} from './index.js';

/** Contrato para el futuro. Shopify no está implementado. */
export class ShopifyAdapter implements PublishingAdapter {
  testConnection(): Promise<ConnectionResult> {
    throw new NotImplementedError('ShopifyAdapter.testConnection');
  }
  listContent(_limit: number): Promise<ContentItem[]> {
    throw new NotImplementedError('ShopifyAdapter.listContent');
  }
  getSamples(_limit: number): Promise<ContentSample[]> {
    throw new NotImplementedError('ShopifyAdapter.getSamples');
  }
  listCategories(_limit: number): Promise<string[]> {
    throw new NotImplementedError('ShopifyAdapter.listCategories');
  }
  createPost(_input: CreatePostInput): Promise<{ id: number; url: string }> {
    throw new NotImplementedError('ShopifyAdapter.createPost');
  }
  updatePost(_id: number, _input: Partial<CreatePostInput>): Promise<void> {
    throw new NotImplementedError('ShopifyAdapter.updatePost');
  }
  searchProducts(_query: string, _limit: number): Promise<StoreProduct[]> {
    throw new NotImplementedError('ShopifyAdapter.searchProducts');
  }
  listAuthors(): Promise<Author[]> {
    throw new NotImplementedError('ShopifyAdapter.listAuthors');
  }
  getPostsInfo(_ids: number[]): Promise<PostInfo[]> {
    throw new NotImplementedError('ShopifyAdapter.getPostsInfo');
  }
  listAttributedOrders(
    _after: Date,
    _page: number,
  ): Promise<{ orders: AttributedOrder[]; hasMore: boolean } | null> {
    throw new NotImplementedError('ShopifyAdapter.listAttributedOrders');
  }
  listVisits(_after: string): Promise<PostVisits[] | null> {
    throw new NotImplementedError('ShopifyAdapter.listVisits');
  }
  listProducts(
    _page: number,
    _ids?: number[],
  ): Promise<{ products: ProductSnapshot[]; hasMore: boolean } | null> {
    throw new NotImplementedError('ShopifyAdapter.listProducts');
  }
  updateProduct(_id: number, _changes: ProductChange[]): Promise<ProductSnapshot> {
    throw new NotImplementedError('ShopifyAdapter.updateProduct');
  }
}
