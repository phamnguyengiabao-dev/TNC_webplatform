/**
 * The stable error-code contract of the HTTP API (docs 11.15).
 *
 * `code` is what the frontend branches on; `title`/`detail` are presentation
 * only. Adding a code here is a contract change: update
 * docs/Spectification/TNCWebPlatform/11_API_Specification.md at the same time.
 */
export const ERROR_CODES = [
  // 400 - bad input
  'VALIDATION_ERROR',
  'IDEMPOTENCY_KEY_REQUIRED',
  'FILE_TOO_LARGE',
  'TOO_MANY_IMAGES',
  'UNSUPPORTED_MEDIA_TYPE',
  // 401 - authentication
  'UNAUTHENTICATED',
  'WEBHOOK_SIGNATURE_INVALID',
  // 403 - authorization
  'FORBIDDEN',
  'ACCOUNT_BLOCKED',
  // 404
  'NOT_FOUND',
  'PROFILE_NOT_FOUND',
  'METHOD_NOT_ALLOWED',
  // 409 - state / money
  'INSUFFICIENT_FUNDS',
  'INVALID_STATE_TRANSITION',
  'ESCROW_EMPTY',
  'ALREADY_REVERSED',
  'OUT_OF_STOCK',
  'IDEMPOTENCY_CONFLICT',
  'IDEMPOTENCY_IN_PROGRESS',
  'CONFLICT',
  'SYNC_ALREADY_RUNNING',
  'SHOPEE_NOT_CONNECTED',
  'ITEM_NOT_LINKED',
  'ITEM_ALREADY_LINKED',
  'SLUG_TAKEN',
  // 410 - gone
  'PRODUCT_UNLISTED',
  // 422 - import / sync input
  'IMPORT_FILE_INVALID',
  'IMPORT_COLUMNS_MISSING',
  // 429
  'RATE_LIMITED',
  // 5xx
  'INTERNAL_ERROR',
  'AUTH_NOT_CONFIGURED',
  'WALLET_NOT_FOUND',
  'SYSTEM_WALLET_MISSING',
  'UNBALANCED_TRANSFER',
  'DUPLICATE_LEG',
  'LEDGER_INTEGRITY_VIOLATION',
  'SERVICE_UNAVAILABLE',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ErrorDescriptor {
  /** HTTP status the code is reported with. */
  status: number;
  /** Short English label - the RFC 7807 `title`. */
  title: string;
  /** Safe, generic Vietnamese copy - shown when no safer detail exists. */
  detail: string;
}

/**
 * Never put wallet ids, balances, account numbers or driver messages in
 * `detail`: this text is returned verbatim to the client.
 */
export const ERROR_CATALOG: Record<ErrorCode, ErrorDescriptor> = {
  VALIDATION_ERROR: {
    status: 400,
    title: 'Validation failed',
    detail: 'Dữ liệu gửi lên không hợp lệ.',
  },
  IDEMPOTENCY_KEY_REQUIRED: {
    status: 400,
    title: 'Idempotency key required',
    detail: 'Thiếu header Idempotency-Key cho thao tác này.',
  },
  FILE_TOO_LARGE: {
    status: 400,
    title: 'File too large',
    detail: 'File vượt quá dung lượng cho phép.',
  },
  TOO_MANY_IMAGES: {
    status: 400,
    title: 'Too many images',
    detail: 'Số lượng ảnh vượt quá giới hạn cho phép.',
  },
  UNSUPPORTED_MEDIA_TYPE: {
    status: 400,
    title: 'Unsupported media type',
    detail: 'Định dạng file không được hỗ trợ.',
  },
  UNAUTHENTICATED: {
    status: 401,
    title: 'Unauthenticated',
    detail: 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn.',
  },
  WEBHOOK_SIGNATURE_INVALID: {
    status: 401,
    title: 'Webhook signature invalid',
    detail: 'Chữ ký webhook không hợp lệ.',
  },
  FORBIDDEN: {
    status: 403,
    title: 'Forbidden',
    detail: 'Bạn không có quyền thực hiện thao tác này.',
  },
  ACCOUNT_BLOCKED: {
    status: 403,
    title: 'Account blocked',
    detail: 'Tài khoản đang bị khoá nên không thể thực hiện giao dịch tiền.',
  },
  NOT_FOUND: {
    status: 404,
    title: 'Not found',
    detail: 'Không tìm thấy tài nguyên.',
  },
  PROFILE_NOT_FOUND: {
    status: 404,
    title: 'Profile not found',
    detail: 'Không tìm thấy hồ sơ người dùng cho tài khoản này.',
  },
  METHOD_NOT_ALLOWED: {
    status: 405,
    title: 'Method not allowed',
    detail: 'Phương thức HTTP không được hỗ trợ cho endpoint này.',
  },
  INSUFFICIENT_FUNDS: {
    status: 409,
    title: 'Insufficient funds',
    detail: 'Số dư ví không đủ để thực hiện giao dịch.',
  },
  INVALID_STATE_TRANSITION: {
    status: 409,
    title: 'Invalid state transition',
    detail: 'Trạng thái hiện tại không cho phép thực hiện thao tác này.',
  },
  ESCROW_EMPTY: {
    status: 409,
    title: 'Escrow empty',
    detail: 'Đơn hàng không còn tiền trong escrow để xử lý.',
  },
  ALREADY_REVERSED: {
    status: 409,
    title: 'Already reversed',
    detail: 'Giao dịch này đã được đảo trước đó.',
  },
  OUT_OF_STOCK: {
    status: 409,
    title: 'Out of stock',
    detail: 'Sản phẩm không đủ tồn kho để giữ chỗ.',
  },
  IDEMPOTENCY_CONFLICT: {
    status: 409,
    title: 'Idempotency conflict',
    detail: 'Idempotency-Key đã được dùng cho một yêu cầu khác.',
  },
  IDEMPOTENCY_IN_PROGRESS: {
    status: 409,
    title: 'Idempotency in progress',
    detail: 'Yêu cầu với Idempotency-Key này đang được xử lý, vui lòng thử lại sau 1-2 giây.',
  },
  CONFLICT: {
    status: 409,
    title: 'Conflict',
    detail: 'Dữ liệu bị xung đột với trạng thái hiện tại.',
  },
  SYNC_ALREADY_RUNNING: {
    status: 409,
    title: 'Sync already running',
    detail: 'Đang có một lần đồng bộ khác chạy, vui lòng thử lại sau.',
  },
  SHOPEE_NOT_CONNECTED: {
    status: 409,
    title: 'Shopee not connected',
    detail: 'Chưa cấu hình kết nối gian hàng Shopee cho thao tác này.',
  },
  ITEM_NOT_LINKED: {
    status: 409,
    title: 'Item not linked',
    detail: 'Sản phẩm chưa được gắn với mặt hàng Shopee (hoặc link mua) nên chưa thể đăng bán.',
  },
  ITEM_ALREADY_LINKED: {
    status: 409,
    title: 'Item already linked',
    detail: 'Mặt hàng Shopee này đã thuộc một sản phẩm khác trên showroom.',
  },
  SLUG_TAKEN: {
    status: 409,
    title: 'Slug already used',
    detail: 'Đường dẫn (slug) này đã được dùng cho sản phẩm khác.',
  },
  PRODUCT_UNLISTED: {
    status: 410,
    title: 'Product unlisted',
    detail: 'Sản phẩm đã ngừng bán trên Shopee.',
  },
  IMPORT_FILE_INVALID: {
    status: 422,
    title: 'Import file invalid',
    detail: 'File import không đọc được hoặc sai định dạng.',
  },
  IMPORT_COLUMNS_MISSING: {
    status: 422,
    title: 'Import columns missing',
    detail: 'File import thiếu cột bắt buộc (mã sản phẩm / tên sản phẩm).',
  },
  RATE_LIMITED: {
    status: 429,
    title: 'Rate limited',
    detail: 'Bạn đã gửi quá nhiều yêu cầu, vui lòng thử lại sau.',
  },
  INTERNAL_ERROR: {
    status: 500,
    title: 'Internal server error',
    detail: 'Đã có lỗi xảy ra, vui lòng thử lại sau.',
  },
  AUTH_NOT_CONFIGURED: {
    status: 500,
    title: 'Authentication not configured',
    detail: 'Máy chủ chưa được cấu hình xác thực.',
  },
  WALLET_NOT_FOUND: {
    status: 500,
    title: 'Wallet not found',
    detail: 'Ví của người dùng chưa được khởi tạo.',
  },
  SYSTEM_WALLET_MISSING: {
    status: 500,
    title: 'System wallet missing',
    detail: 'Ví hệ thống chưa được khởi tạo đầy đủ.',
  },
  UNBALANCED_TRANSFER: {
    status: 500,
    title: 'Unbalanced transfer',
    detail: 'Giao dịch nội bộ không cân đối.',
  },
  DUPLICATE_LEG: {
    status: 500,
    title: 'Duplicate ledger leg',
    detail: 'Giao dịch nội bộ có bút toán trùng ví.',
  },
  LEDGER_INTEGRITY_VIOLATION: {
    status: 500,
    title: 'Ledger integrity violation',
    detail: 'Phát hiện sai lệch bất biến dữ liệu sổ cái.',
  },
  SERVICE_UNAVAILABLE: {
    status: 503,
    title: 'Service unavailable',
    detail: 'Dịch vụ tạm thời không khả dụng, vui lòng thử lại sau.',
  },
};

export function errorDescriptor(code: ErrorCode): ErrorDescriptor {
  return ERROR_CATALOG[code];
}

/** Type guard for the duck-typed `code` property of domain errors. */
export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(ERROR_CATALOG, value);
}

/** RFC 7807 `type` URI for a code. Stable per code, safe to link to docs. */
export function errorTypeUri(code: ErrorCode): string {
  return `https://tnc.vn/errors/${code.toLowerCase().replace(/_/g, '-')}`;
}

/**
 * Fallback mapping for framework-thrown HttpExceptions that carry no domain
 * code (ValidationPipe, unmatched routes, payload limits...).
 */
export const HTTP_STATUS_TO_CODE: Readonly<Record<number, ErrorCode>> = {
  400: 'VALIDATION_ERROR',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  405: 'METHOD_NOT_ALLOWED',
  409: 'CONFLICT',
  410: 'PRODUCT_UNLISTED',
  413: 'FILE_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  422: 'VALIDATION_ERROR',
  429: 'RATE_LIMITED',
  503: 'SERVICE_UNAVAILABLE',
};

export function codeForHttpStatus(status: number): ErrorCode {
  const mapped = HTTP_STATUS_TO_CODE[status];
  if (mapped) return mapped;
  return status >= 500 ? 'INTERNAL_ERROR' : 'VALIDATION_ERROR';
}
