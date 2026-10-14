import type { ShopeeItemStatus } from '@prisma/client';

/**
 * Visibility policy: who may be shown, and who may be bought.
 *
 * Kept pure so the rules can be unit-tested without a database, and so the
 * read path (catalog) and the write path (sync) cannot drift apart: both call
 * the same functions.
 *
 * Rules fixed by docs/backend/SHOPEE_SHOWROOM_BACKEND.md 2.5:
 *   - BANNED / DELETED        -> hidden immediately.
 *   - NOT_SEEN, older than N  -> hidden (the item vanished from the source).
 *   - UNLIST                  -> still shown; Shopee just is not selling it
 *                                right now, which is a `purchasable: false`
 *                                state, not a takedown.
 */

const MS_PER_DAY = 86_400_000;

/** Trạng thái item buộc phải ẩn sản phẩm ngay lập tức. */
const IMMEDIATE_HIDE: readonly ShopeeItemStatus[] = ['BANNED', 'DELETED'];

export interface AvailabilityItem {
  itemStatus: ShopeeItemStatus;
  lastSeenAt: Date;
  stock: number | null;
}

export type HideReason = 'BANNED' | 'DELETED' | 'NOT_SEEN_EXPIRED';

/**
 * Vì sao item này không còn được phép hiển thị, hoặc `null` nếu vẫn hiển thị.
 * Item không gắn Shopee (`item === null`) không bị ẩn bởi sync.
 */
export function hideReasonFor(
  item: AvailabilityItem | null,
  now: Date,
  hideAfterDays: number,
): HideReason | null {
  if (!item) return null;
  if (item.itemStatus === 'BANNED') return 'BANNED';
  if (item.itemStatus === 'DELETED') return 'DELETED';
  if (item.itemStatus === 'NOT_SEEN') {
    const ageMs = now.getTime() - item.lastSeenAt.getTime();
    if (ageMs > hideAfterDays * MS_PER_DAY) return 'NOT_SEEN_EXPIRED';
  }
  return null;
}

/** Ngưỡng `lastSeenAt` mà từ đó một item NOT_SEEN bị coi là đã biến mất. */
export function notSeenCutoff(now: Date, hideAfterDays: number): Date {
  return new Date(now.getTime() - hideAfterDays * MS_PER_DAY);
}

/** Còn hàng theo dữ liệu Shopee (tồn kho không xác định = coi như còn). */
export function isInStock(item: Pick<AvailabilityItem, 'stock'> | null): boolean {
  if (!item) return true;
  return item.stock === null || item.stock > 0;
}

/**
 * Bấm "Mua trên Shopee" có dẫn tới nơi bán được hay không. UNLIST và hết hàng
 * vẫn hiển thị (khách còn soi được sản phẩm) nhưng nút mua bị vô hiệu hoá.
 */
export function isPurchasable(item: AvailabilityItem | null): boolean {
  if (!item) return true; // buyUrlOverride / liên hệ trực tiếp
  return item.itemStatus === 'NORMAL' && isInStock(item);
}

/** Nhãn trạng thái bán để frontend dịch; ổn định như `code` lỗi. */
export type PurchaseState = 'ON_SALE' | 'OUT_OF_STOCK' | 'PAUSED' | 'UNAVAILABLE';

export function purchaseStateFor(item: AvailabilityItem | null): PurchaseState {
  if (!item) return 'ON_SALE';
  if (IMMEDIATE_HIDE.includes(item.itemStatus)) return 'UNAVAILABLE';
  if (item.itemStatus === 'NOT_SEEN') return 'PAUSED';
  if (item.itemStatus === 'UNLIST') return 'PAUSED';
  return isInStock(item) ? 'ON_SALE' : 'OUT_OF_STOCK';
}
