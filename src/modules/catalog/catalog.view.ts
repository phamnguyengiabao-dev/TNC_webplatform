import { Prisma } from '@prisma/client';

import { toJson } from '../../common/money';
import { SEAL_STATUSES, type SealStatus } from './catalog.constants';
import { isInStock, purchaseStateFor, type PurchaseState } from './catalog.policy';

/** Quan hệ mà mọi truy vấn catalog phải nạp để dựng view. */
export const PRODUCT_INCLUDE = {
  collection: { select: { slug: true, title: true } },
  shopeeItem: { include: { shop: { select: { shopeeShopId: true } } } },
} satisfies Prisma.ProductInclude;

export type ProductWithRelations = Prisma.ProductGetPayload<{ include: typeof PRODUCT_INCLUDE }>;

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
  /** Giá VND dạng chuỗi (quy ước tiền tệ của API) - không bao giờ là number. */
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
  /** Khối trust: vệ sinh/UV, nguồn gốc, chính hãng... (copy tự do của staff). */
  qa: Record<string, unknown> | null;
  shopee: ShopeeBlockView | null;
  /** Đường dẫn ghi nhận click + 302 sang Shopee (khuyến nghị dùng cho <a href>). */
  buyPath: string;
  /** Deep-link đã resolve; null khi chưa gắn Shopee và không có override. */
  buyUrl: string | null;
}

export interface BuyContext {
  /** Origin của API, ví dụ "https://api.tnc.vn" (đã bỏ dấu "/" cuối). */
  apiOrigin: string;
  /** Storefront Shopee, ví dụ "https://shopee.vn". */
  storefrontBaseUrl: string;
  /** Query nối thêm vào deep-link mặc định (không áp cho buyUrlOverride). */
  trackingSuffix: string;
}

export function toCardView(product: ProductWithRelations, buy: BuyContext): ProductCardView {
  const item = product.shopeeItem;
  const images = toImageList(item?.imageUrls);

  return {
    id: product.id,
    slug: product.slug,
    title: productTitle(product),
    collection: product.collection.slug,
    collectionTitle: product.collection.title,
    blurb: product.blurb,
    condition: {
      percentLeft: product.conditionPercent,
      seal: toSealStatus(product.sealStatus),
      badges: toStringList(product.badges),
    },
    price: item?.price ? toJson(item.price) : null,
    priceMin: item?.priceMin ? toJson(item.priceMin) : null,
    priceMax: item?.priceMax ? toJson(item.priceMax) : null,
    inStock: isInStock(item),
    purchaseState: purchaseStateFor(item),
    image: images[0] ?? null,
    images,
    featuredRank: product.featuredRank,
    publishedAt: product.publishedAt?.toISOString() ?? null,
  };
}

export function toDetailView(product: ProductWithRelations, buy: BuyContext): ProductDetailView {
  const card = toCardView(product, buy);
  const item = product.shopeeItem;
  const buyUrl = resolveBuyUrl(product, buy);

  return {
    ...card,
    qa: toPlainObject(product.qaNotes),
    shopee: item
      ? {
          itemId: item.itemId.toString(),
          shopId: item.shop.shopeeShopId.toString(),
          price: item.price ? toJson(item.price) : null,
          priceMin: item.priceMin ? toJson(item.priceMin) : null,
          priceMax: item.priceMax ? toJson(item.priceMax) : null,
          stock: item.stock,
          status: item.itemStatus,
          url: shopeeListingUrl(item.shop.shopeeShopId, item.itemId, buy.storefrontBaseUrl, buy.trackingSuffix),
          syncedAt: item.lastSeenAt.toISOString(),
        }
      : null,
    buyPath: `${buy.apiOrigin}/api/v1/catalog/products/${product.id}/buy`,
    buyUrl,
  };
}

/**
 * Deep-link của nút "Mua trên Shopee".
 *
 * `buyUrlOverride` thắng (link affiliate / link liên hệ cho món pre-loved
 * không có listing riêng); nếu không thì suy ra từ `(shopId, itemId)`.
 */
export function resolveBuyUrl(product: ProductWithRelations, buy: BuyContext): string | null {
  const override = product.buyUrlOverride?.trim();
  if (override) return override;

  const item = product.shopeeItem;
  if (!item) return null;
  const affiliateUrl = item.affiliateUrl?.trim();
  if (affiliateUrl && isSafeAffiliateUrl(affiliateUrl)) return affiliateUrl;
  return shopeeListingUrl(item.shop.shopeeShopId, item.itemId, buy.storefrontBaseUrl, buy.trackingSuffix);
}

function isSafeAffiliateUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' &&
      (url.hostname === 'shopee.vn' || url.hostname.endsWith('.shopee.vn') || url.hostname === 'shope.ee');
  } catch {
    return false;
  }
}

export function shopeeListingUrl(
  shopeeShopId: bigint,
  itemId: bigint,
  storefrontBaseUrl: string,
  trackingSuffix: string,
): string {
  return `${storefrontBaseUrl}/product/${shopeeShopId.toString()}/${itemId.toString()}${trackingSuffix}`;
}

export function productTitle(product: Pick<ProductWithRelations, 'displayTitle' | 'shopeeItem'>): string {
  const title = product.displayTitle?.trim() || product.shopeeItem?.itemName?.trim();
  return title && title.length > 0 ? title : 'Sản phẩm chưa đặt tên';
}

function toImageList(value: Prisma.JsonValue | null | undefined): string[] {
  return toStringList(value);
}

function toStringList(value: Prisma.JsonValue | null | undefined): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0);
}

function toSealStatus(value: string | null): SealStatus | null {
  if (!value) return null;
  return (SEAL_STATUSES as readonly string[]).includes(value) ? (value as SealStatus) : null;
}

function toPlainObject(value: Prisma.JsonValue | null | undefined): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}
