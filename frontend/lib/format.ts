const VND = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 });

/**
 * Giá đến từ API dưới dạng **chuỗi** (quy ước tiền tệ của backend). Chỉ định
 * dạng để hiển thị - tuyệt đối không parseFloat rồi tính toán trên client.
 */
export function formatPrice(value: string | null | undefined): string | null {
  if (!value) return null;
  const digits = value.trim();
  if (!/^\d+$/.test(digits)) return null;
  return `${VND.format(BigInt(digits))}₫`;
}

export function formatPercent(value: number): string {
  return `${value}%`;
}

export function formatDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('vi-VN', { dateStyle: 'medium' }).format(date);
}

/** 450000 -> "từ 450.000₫" khi sản phẩm có nhiều phân loại giá. */
export function formatPriceRange(
  price: string | null,
  priceMin: string | null,
  priceMax: string | null,
): { display: string; isRange: boolean } | null {
  const single = formatPrice(price);
  const min = formatPrice(priceMin);
  const max = formatPrice(priceMax);

  if (single) {
    const isRange = Boolean(min && max && min !== max);
    return { display: isRange ? `${single}` : single, isRange };
  }
  if (min && max && min !== max) return { display: `${min} – ${max}`, isRange: true };
  return null;
}
