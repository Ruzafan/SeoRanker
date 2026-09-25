import { NotImplementedError } from '../errors.js';
import type {
  AttributedOrder,
  ConnectionResult,
  PostInfo,
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
  getPostsInfo(_ids: number[]): Promise<PostInfo[]> {
    throw new NotImplementedError('ShopifyAdapter.getPostsInfo');
  }
  listAttributedOrders(
    _after: Date,
    _page: number,
  ): Promise<{ orders: AttributedOrder[]; hasMore: boolean } | null> {
    throw new NotImplementedError('ShopifyAdapter.listAttributedOrders');
  }
}
