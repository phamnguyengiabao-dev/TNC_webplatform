import type { ConditionView, PurchaseState, SealStatus } from './types';

/**
 * Bảng dịch của storefront: token máy đọc (backend) -> câu chữ tiếng Việt.
 *
 * Quy ước: component dùng chung không bao giờ hard-code nhãn; mọi chữ hiển thị
 * đi qua file này để sau này thêm ngôn ngữ chỉ phải sửa một chỗ.
 */

export const SEAL_LABELS: Record<SealStatus, string> = {
  sealed: 'Nguyên seal',
  opened: 'Đã mở hộp',
  swatched: 'Đã quẹt thử',
  used: 'Đã qua sử dụng',
  unknown: 'Chưa kiểm định',
};

export const PURCHASE_STATE_LABELS: Record<PurchaseState, string> = {
  ON_SALE: 'Đang bán trên Shopee',
  OUT_OF_STOCK: 'Tạm hết hàng',
  PAUSED: 'Tạm ngừng bán',
  UNAVAILABLE: 'Ngừng bán',
};

/** Tình trạng pre-loved đọc nhanh trên card: "Còn 95% · Đã mở hộp". */
export function conditionLabel(condition: ConditionView): string | null {
  const parts: string[] = [];
  if (condition.percentLeft !== null) parts.push(`Còn ${condition.percentLeft}%`);
  if (condition.seal && condition.seal !== 'unknown') parts.push(SEAL_LABELS[condition.seal]);
  if (parts.length > 0) return parts.join(' · ');
  return condition.seal === 'unknown' ? SEAL_LABELS.unknown : null;
}

/** Badge hiển thị trên card: tình trạng trước, rồi badge tự do của staff. */
export function productTags(input: {
  collection: string;
  condition: ConditionView;
}): string[] {
  if (input.collection === 'pristine-retail') {
    const extra = input.condition.badges;
    return extra.length > 0 ? extra : ['Nguyên seal'];
  }
  const primary = conditionLabel(input.condition);
  const extras = input.condition.badges.filter((badge) => badge !== primary);
  return [primary, ...extras].filter((tag): tag is string => Boolean(tag)).slice(0, 3);
}

export const QA_LABELS: Record<string, string> = {
  sterilized: 'Vệ sinh & khử khuẩn',
  origin: 'Nguồn gốc',
  authenticity: 'Cam kết chính hãng',
  expiresOn: 'Hạn sử dụng',
  batchCode: 'Batch code',
  inspectedBy: 'Người kiểm định',
  inspectedAt: 'Ngày kiểm định',
};

export function qaLabel(key: string): string {
  return QA_LABELS[key] ?? key;
}

export const AUTHENTICITY_LABELS: Record<string, string> = {
  verified: 'Đã đối chiếu hoá đơn & tem',
  'receipt-checked': 'Đã kiểm tra hoá đơn mua',
  'self-declared': 'Người bán tự khai',
};

/**
 * Câu chữ cho lỗi API. `code` là hợp đồng ổn định; câu chữ có thể sửa tự do.
 * Mỗi lỗi có một hành động để người dùng biết bấm vào đâu tiếp theo.
 */
const ERROR_COPY: Record<string, { message: string; action: string }> = {
  PRODUCT_UNLISTED: {
    message: 'Sản phẩm này đã tạm ngừng bán trên showroom.',
    action: 'Xem sản phẩm khác',
  },
  NOT_FOUND: {
    message: 'Không tìm thấy sản phẩm bạn đang xem.',
    action: 'Về trang bộ sưu tập',
  },
  VALIDATION_ERROR: {
    message: 'Bộ lọc chưa hợp lệ, bạn thử lại giúp mình nhé.',
    action: 'Xoá bộ lọc',
  },
  SERVICE_UNAVAILABLE: {
    message: 'Showroom đang bận một chút, bạn thử lại sau vài giây.',
    action: 'Thử lại',
  },
  RATE_LIMITED: {
    message: 'Bạn thao tác hơi nhanh, chờ một chút rồi thử lại nhé.',
    action: 'Thử lại',
  },
};

const ERROR_FALLBACK = {
  message: 'Có lỗi xảy ra khi tải dữ liệu từ showroom.',
  action: 'Thử lại',
};

export function errorCopy(code: string | undefined): { message: string; action: string } {
  if (!code) return ERROR_FALLBACK;
  return ERROR_COPY[code] ?? ERROR_FALLBACK;
}

/** Nhãn tab bộ sưu tập khi API chưa kịp trả `theme`. */
export const COLLECTION_FALLBACKS: Record<string, { eyebrow: string; note: string }> = {
  'pristine-retail': {
    eyebrow: 'Quầy counter',
    note: 'Hàng mới nguyên seal, hoá đơn đầy đủ.',
  },
  'curated-preloved': {
    eyebrow: 'Tủ đồ vintage',
    note: 'Từng món đều được soi kỹ và ghi rõ mức dung tích còn lại.',
  },
};

export function collectionTheme(
  slug: string,
  theme: Record<string, unknown> | null,
): { eyebrow: string; note: string } {
  const fallback = COLLECTION_FALLBACKS[slug] ?? { eyebrow: 'Bộ sưu tập', note: '' };
  const eyebrow = typeof theme?.eyebrow === 'string' ? theme.eyebrow : fallback.eyebrow;
  const note = typeof theme?.note === 'string' ? theme.note : fallback.note;
  return { eyebrow, note };
}
