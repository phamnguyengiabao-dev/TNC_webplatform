/** Hợp đồng dữ liệu của API catalog (docs 11.16). Không tự suy diễn thêm. */

export type SealStatus = 'sealed' | 'opened' | 'swatched' | 'used' | 'unknown';

export type PurchaseState = 'ON_SALE' | 'OUT_OF_STOCK' | 'PAUSED' | 'UNAVAILABLE';

export interface CollectionView {
  slug: string;
  title: string;
  subtitle: string | null;
  theme: Record<string, unknown> | null;
  productCount: number;
}

export interface ConditionView {
  percentLeft: number | null;
  seal: SealStatus | null;
  badges: string[];
}

export interface ProductCardView {
  id: string;
  slug: string;
  title: string;
  collection: string;
  collectionTitle: string;
  blurb: string | null;
  condition: ConditionView;
  /** Chuỗi VND - chỉ hiển thị, không bao giờ parseFloat để tính. */
  price: string | null;
  priceMin: string | null;
  priceMax: string | null;
  inStock: boolean;
  purchaseState: PurchaseState;
  image: string | null;
  images: string[];
  featuredRank: number | null;
  publishedAt: string | null;
}

export interface ShopeeBlockView {
  itemId: string;
  shopId: string;
  price: string | null;
  priceMin: string | null;
  priceMax: string | null;
  stock: number | null;
  status: string;
  url: string;
  syncedAt: string | null;
}

export interface ProductDetailView extends ProductCardView {
  qa: Record<string, unknown> | null;
  shopee: ShopeeBlockView | null;
  buyPath: string;
  buyUrl: string | null;
}

export interface ProductPage {
  items: ProductCardView[];
  nextCursor: string | null;
}

export interface CollectionList {
  items: CollectionView[];
}

export type CatalogSort = 'newest' | 'featured' | 'price_asc' | 'price_desc';

export interface CatalogQuery {
  collection?: string;
  q?: string;
  condition_min?: number;
  price_min?: string;
  price_max?: string;
  in_stock?: boolean;
  sort?: CatalogSort;
  cursor?: string;
  take?: number;
}

/** RFC 7807 body mà mọi lỗi của backend trả về. */
export interface ApiProblem {
  type: string;
  title: string;
  status: number;
  code: string;
  detail?: string;
  requestId?: string;
}
