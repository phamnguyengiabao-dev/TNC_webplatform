import { AppError } from '../../common/errors/app-error';
import { CATALOG_SORTS, type CatalogSort } from './catalog.constants';

/**
 * Keyset cursor for GET /catalog/products.
 *
 * Opaque to clients on purpose: the payload carries the last row's sort key
 * plus its id (the tie-breaker), so a page never has to be OFFSET-scanned and
 * rows cannot be skipped when new products are published mid-scroll.
 */
export interface CatalogCursor {
  sort: CatalogSort;
  /** String form of the sort key: ISO timestamp, price in đồng, or null. */
  key: string | null;
  /** Tie-breaker: `Product.id`. */
  id: string;
}

const CURSOR_VERSION = 1;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_CURSOR_LENGTH = 512;
const MAX_KEY_LENGTH = 64;

export function encodeCursor(cursor: CatalogCursor): string {
  const payload = JSON.stringify({ v: CURSOR_VERSION, ...cursor });
  return Buffer.from(payload, 'utf8').toString('base64url');
}

export function decodeCursor(raw: string): CatalogCursor {
  if (raw.length > MAX_CURSOR_LENGTH) {
    throw invalidCursor('cursor is longer than 512 characters');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    throw invalidCursor('cursor is not valid base64url JSON');
  }

  if (typeof parsed !== 'object' || parsed === null) throw invalidCursor('cursor payload is not an object');
  const payload = parsed as Partial<CatalogCursor> & { v?: unknown };

  if (payload.v !== CURSOR_VERSION) throw invalidCursor(`unsupported cursor version ${String(payload.v)}`);
  if (typeof payload.sort !== 'string' || !CATALOG_SORTS.includes(payload.sort as CatalogSort)) {
    throw invalidCursor(`unknown sort in cursor: ${String(payload.sort)}`);
  }
  if (typeof payload.id !== 'string' || !UUID_PATTERN.test(payload.id)) {
    throw invalidCursor('cursor is missing the tie-breaker id');
  }
  if (payload.key !== null && payload.key !== undefined && typeof payload.key !== 'string') {
    throw invalidCursor('cursor sort key must be a string or null');
  }
  if (typeof payload.key === 'string' && payload.key.length > MAX_KEY_LENGTH) {
    throw invalidCursor('cursor sort key is too long');
  }

  return {
    sort: payload.sort as CatalogSort,
    key: typeof payload.key === 'string' ? payload.key : null,
    id: payload.id,
  };
}

function invalidCursor(logMessage: string): AppError {
  return new AppError('VALIDATION_ERROR', {
    logMessage: `invalid catalog cursor: ${logMessage}`,
    detail: 'Cursor phân trang không hợp lệ, vui lòng tải lại danh sách.',
  });
}
