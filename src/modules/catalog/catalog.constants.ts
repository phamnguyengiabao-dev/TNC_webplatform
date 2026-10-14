/** Giao ước hiển thị của showroom (docs/backend/SHOPEE_SHOWROOM_BACKEND.md 4.2). */

export const DEFAULT_PAGE_SIZE = 24;
export const MAX_PAGE_SIZE = 48;

/**
 * Bao lâu kể từ lần cuối thấy item trong nguồn sync thì coi như đã biến mất.
 * `SHOPEE_ITEM_HIDE_AFTER_DAYS` ghi đè; 7 ngày là mặc định đã chốt trong spec.
 */
export const DEFAULT_NOT_SEEN_HIDE_DAYS = 7;

/**
 * Tình trạng seal/kết cấu của món pre-loved. Đây là token máy đọc - frontend
 * mới là nơi dịch sang nhãn tiếng Việt (`[New In Box]`, `[Swatched Once]`...).
 */
export const SEAL_STATUSES = ['sealed', 'opened', 'swatched', 'used', 'unknown'] as const;
export type SealStatus = (typeof SEAL_STATUSES)[number];

/** Sort hợp lệ của GET /catalog/products. */
export const CATALOG_SORTS = ['newest', 'featured', 'price_asc', 'price_desc'] as const;
export type CatalogSort = (typeof CATALOG_SORTS)[number];

/** Trần độ dài của `q` - chặn payload search rác. */
export const MAX_QUERY_LENGTH = 120;

/** Số byte tối đa của referrer lưu vào OutboundClick. */
export const MAX_REFERRER_LENGTH = 500;
