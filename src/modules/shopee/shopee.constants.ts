import type { ShopeeSourceStatus } from './providers/shopee-sync-provider.interface';

/**
 * Hằng số & ánh xạ cột cho import file export từ Shopee Seller Center
 * (Mass Upload -> Validate -> Export).
 *
 * Template Shopee đổi theo thời gian và theo ngôn ngữ (VN/EN), nên parser khớp
 * cột "dung sai": chuẩn hoá - thường hoá, bỏ dấu tiếng Việt, gộp mọi ký tự
 * phân cách thành một khoảng trắng - rồi so khớp exact với danh sách alias
 * xếp theo độ ưu tiên giảm dần.
 */

/** Trần dung lượng file import; phải khớp `limits.fileSize` của SyncAdminController. */
export const IMPORT_MAX_BYTES = 10 * 1024 * 1024;

/** Trần số dòng dữ liệu một file import được xử lý. */
export const IMPORT_MAX_ROWS = 20_000;

/** Số dòng đầu được quét để tìm dòng tiêu đề (template có thể có dòng title phía trên). */
export const HEADER_SCAN_ROWS = 10;

/** Chuẩn hoá tên cột: "Mã sản phẩm (ID)" -> "ma san pham id". */
export function normalizeHeader(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export type CatalogField =
  | 'itemId'
  | 'name'
  | 'modelId'
  | 'modelName'
  | 'price'
  | 'priceMin'
  | 'priceMax'
  | 'stock'
  | 'status'
  | 'description'
  | 'updateTime';

/**
 * Alias theo thứ tự ưu tiên giảm dần. Template Mass Upload có thể chứa cả
 * "ID sản phẩm" (item id thật của Shopee) lẫn "Mã sản phẩm" (SKU người bán tự
 * đặt) - alias đứng trước được chọn.
 */
const RAW_COLUMN_ALIASES: Record<CatalogField, readonly string[]> = {
  itemId: [
    'ID sản phẩm',
    'Item ID',
    'item_id',
    'Product ID',
    'Mã sản phẩm (ID)',
    'Mã sản phẩm',
    'Mã SP',
    'Mã item',
  ],
  name: ['Tên sản phẩm', 'Item Name', 'Product Name', 'Tên SP', 'Tên'],
  modelId: ['Mã phân loại', 'Mã phân loại hàng', 'SKU', 'Model ID', 'Mã SKU'],
  modelName: ['Tên phân loại', 'Tên nhóm phân loại', 'Tên phân loại hàng', 'Model Name'],
  price: ['Giá', 'Giá bán', 'Giá bán lẻ', 'Giá niêm yết', 'Price', 'Giá (VND)'],
  priceMin: ['Giá tối thiểu', 'Giá thấp nhất', 'Price Min'],
  priceMax: ['Giá tối đa', 'Giá cao nhất', 'Price Max'],
  stock: ['Tồn kho', 'Số lượng tồn kho', 'Kho hàng', 'Số lượng', 'Stock'],
  status: ['Trạng thái', 'Trạng thái bán', 'Tình trạng', 'Status', 'Item Status'],
  description: ['Mô tả sản phẩm', 'Mô tả', 'Description', 'Mô tả chi tiết'],
  updateTime: ['Thời gian cập nhật', 'Ngày cập nhật', 'Cập nhật lúc', 'Update Time'],
};

export const COLUMN_ALIASES: Readonly<Record<CatalogField, readonly string[]>> = Object.fromEntries(
  Object.entries(RAW_COLUMN_ALIASES).map(([field, aliases]) => [
    field,
    aliases.map(normalizeHeader),
  ]),
) as unknown as Record<CatalogField, readonly string[]>;

/** Cột ảnh: template tách "Ảnh 1", "Ảnh 2"... nên khớp theo mẫu, không exact. */
export const IMAGE_COLUMN_PATTERN = /^(anh|anh bia|hinh anh|link anh|image|image url)( \d+)?$/;

/** Cột bắt buộc phải có để import chạy được. */
export const REQUIRED_COLUMNS: readonly CatalogField[] = ['itemId', 'name'];

const RAW_STATUS_ALIASES: Record<ShopeeSourceStatus, readonly string[]> = {
  NORMAL: ['Đang bán', 'Bình thường', 'Hoạt động', 'Normal', 'Active'],
  UNLIST: ['Tạm ẩn', 'Đã ẩn', 'Ẩn', 'Unlisted', 'Unlist', 'Hidden'],
  BANNED: ['Bị khóa', 'Bị cấm', 'Khóa', 'Banned', 'Vi phạm', 'Bị chặn'],
  DELETED: ['Đã xóa', 'Xóa', 'Deleted', 'Removed'],
};

/** Ô trạng thái đã chuẩn hoá -> trạng thái nguồn. */
export const STATUS_LOOKUP: ReadonlyMap<string, ShopeeSourceStatus> = new Map(
  Object.entries(RAW_STATUS_ALIASES).flatMap(([status, aliases]) =>
    aliases.map((alias) => [normalizeHeader(alias), status as ShopeeSourceStatus] as const),
  ),
);