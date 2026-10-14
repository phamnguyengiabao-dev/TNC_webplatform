import type { ShopeeItemStatus } from '@prisma/client';

/**
 * Trạng thái mặt hàng mà provider được phép báo về. `NOT_SEEN` do sync engine
 * tự suy ra (item không còn xuất hiện trong nguồn), provider không bao giờ gửi.
 */
export type ShopeeSourceStatus = Exclude<ShopeeItemStatus, 'NOT_SEEN'>;

/**
 * Một phân loại (model/variant) của item. Template export của Shopee trả mỗi
 * phân loại một dòng; parser gộp chúng thành `ItemSnapshot.models`.
 */
export interface ItemModelSnapshot {
  modelId: string;
  name: string;
  /** Decimal dạng string - giá của riêng phân loại. */
  price?: string;
  stock?: number;
}

/**
 * Ảnh chụp một mặt hàng tại một thời điểm nguồn (file export hoặc API call).
 *
 * Đây là hợp đồng duy nhất giữa provider và sync engine: thêm provider mới
 * (affiliate, open_platform) chỉ cần trả về đúng cấu trúc này, engine không đổi.
 * Xem docs/backend/SHOPEE_SHOWROOM_BACKEND.md muc 2.3.
 */
export interface ItemSnapshot {
  shopeeItemId: string;
  name: string;
  status: ShopeeSourceStatus;
  /** Giá hiển thị; item có phân loại thì đây là giá thấp nhất. Decimal dạng string. */
  price?: string;
  priceMin?: string;
  priceMax?: string;
  stock?: number;
  imageUrls: string[];
  /** Affiliate tracking link, nếu nguồn cung cấp. */
  affiliateUrl?: string;
  description?: string;
  shopeeUpdateTime?: Date;
  models?: ItemModelSnapshot[];
  /** Dữ liệu gốc để audit - phải là JSON-safe. */
  raw: unknown;
}

/** Con trỏ phân trang / tăng dần cho provider API (S4/S5); CSV không dùng. */
export interface SyncCursor {
  value: string;
}

export interface SyncCatalogResult {
  items: ItemSnapshot[];
  nextCursor?: SyncCursor;
}

export interface ShopeeItemRef {
  shopeeShopId: string;
  shopeeItemId: string;
}

/**
 * Nguồn dữ liệu Shopee cắm rời được. Sync engine chỉ nhận `ItemSnapshot[]`
 * nên việc thay provider (csv -> affiliate -> open_platform) không đổi engine.
 */
export interface ShopeeSyncProvider {
  readonly name: 'csv' | 'affiliate' | 'open_platform';

  /** Kéo catalog từ nguồn (API providers). CSV không hỗ trợ - dùng `parse()`. */
  fetchCatalog(cursor?: SyncCursor): Promise<SyncCatalogResult>;

  /** Link mua chuẩn trên Shopee; S4 sẽ thay bằng affiliate short link. */
  buildBuyUrl(item: ShopeeItemRef): Promise<string> | string;
}
