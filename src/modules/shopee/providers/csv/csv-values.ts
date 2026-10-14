import { Prisma } from '@prisma/client';

/** Giá trị ô đã bóc khỏi cấu trúc ExcelJS (rich text / formula / hyperlink). */
export type CellValue = string | number | null;

/** Bóc giá trị hiển thị thật của một ô ExcelJS về string | number | null. */
export function cellToValue(raw: unknown): CellValue {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw === 'boolean') return raw ? 'true' : 'false';
  if (raw instanceof Date) return raw.toISOString();
  if (typeof raw === 'object') {
    const record = raw as Record<string, unknown>;
    if (Array.isArray(record.richText)) {
      const text = record.richText
        .map((part) =>
          part !== null && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string'
            ? (part as { text: string }).text
            : '',
        )
        .join('')
        .trim();
      return text.length > 0 ? text : null;
    }
    if ('text' in record) return cellToValue(record.text);
    if ('result' in record) return cellToValue(record.result);
  }
  return null;
}

export interface ParseOk<T> {
  ok: true;
  value: T;
}

export interface ParseFailure {
  ok: false;
  reason: string;
}

/** Item id / model id: chuỗi số nguyên BigInt-safe (ô số của Excel cũng chấp nhận). */
export function parseItemIdCell(value: CellValue): ParseOk<string> | ParseFailure {
  if (value === null) return { ok: false, reason: 'thiếu mã sản phẩm' };
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) {
      return { ok: false, reason: `mã sản phẩm không phải số nguyên an toàn: ${value}` };
    }
    return { ok: true, value: String(value) };
  }
  const compact = value.replace(/\s+/g, '').replace(/\.0+$/, '');
  if (!/^\d{1,19}$/.test(compact)) {
    return { ok: false, reason: `mã sản phẩm không hợp lệ: "${value}"` };
  }
  return { ok: true, value: compact };
}

/** Giá trị VND tối đa vừa Decimal(12,2). */
const MAX_MONEY = '9999999999.99';

/** Trần tồn kho hợp lệ (dữ liệu Shopee thực tế nhỏ hơn rất nhiều). */
const MAX_STOCK = 10_000_000;

/**
 * Đọc tiền từ ô dữ liệu: chấp nhận "450.000", "450,000", "1.234.567,89",
 * "450000 ₫" hoặc ô số thuần. Trả về Decimal dạng string (2 chữ số thập phân).
 */
export function parseMoneyCell(
  value: CellValue,
  label = 'giá',
): ParseOk<string> | ParseFailure {
  if (value === null) return { ok: false, reason: `thiếu ${label}` };
  const raw = typeof value === 'number' ? String(value) : value;
  const compact = raw.replace(/\s+/g, '').replace(/[^\d.,]/g, '');
  if (!compact) return { ok: false, reason: `${label} không đọc được từ "${raw}"` };

  const hasDot = compact.includes('.');
  const hasComma = compact.includes(',');
  let normalized: string;
  if (hasDot && hasComma) {
    // Separator đứng sau cùng là dấu thập phân: "1.234.567,89" (VN) vs "1,234,567.89" (EN).
    normalized =
      compact.lastIndexOf(',') > compact.lastIndexOf('.')
        ? compact.replace(/\./g, '').replace(',', '.')
        : compact.replace(/,/g, '');
  } else if (hasDot) {
    normalized = /^\d{1,3}(\.\d{3})+$/.test(compact) ? compact.replace(/\./g, '') : compact;
  } else if (hasComma) {
    normalized = /^\d{1,3}(,\d{3})+$/.test(compact)
      ? compact.replace(/,/g, '')
      : compact.replace(',', '.');
  } else {
    normalized = compact;
  }

  let parsed: Prisma.Decimal;
  try {
    parsed = new Prisma.Decimal(normalized);
  } catch {
    return { ok: false, reason: `${label} không hợp lệ: "${raw}"` };
  }
  if (!parsed.isFinite() || parsed.isNegative()) {
    return { ok: false, reason: `${label} không hợp lệ: "${raw}"` };
  }
  if (parsed.greaterThan(MAX_MONEY)) {
    return { ok: false, reason: `${label} vượt giới hạn: "${raw}"` };
  }
  return { ok: true, value: parsed.toFixed(2) };
}

/** Ô tồn kho: số nguyên không âm. */
export function parseStockCell(value: CellValue): ParseOk<number> | ParseFailure {
  const parsed = parseMoneyCell(value, 'tồn kho');
  if (!parsed.ok) return parsed;
  const decimal = new Prisma.Decimal(parsed.value);
  if (!decimal.isInteger()) {
    return { ok: false, reason: `tồn kho không phải số nguyên: "${String(value)}"` };
  }
  const asNumber = decimal.toNumber();
  if (asNumber > MAX_STOCK) {
    return { ok: false, reason: `tồn kho vượt giới hạn: "${String(value)}"` };
  }
  return { ok: true, value: asNumber };
}

/** Tách danh sách URL ảnh trong một ô (Shopee tách bằng dấu phẩy / xuống dòng). */
export function splitImageUrls(value: CellValue): string[] {
  if (value === null) return [];
  const raw = typeof value === 'number' ? String(value) : value;
  const urls = raw.split(/[\s,;|]+/).filter((token) => /^https?:\/\//i.test(token));
  return [...new Set(urls)].slice(0, 20);
}