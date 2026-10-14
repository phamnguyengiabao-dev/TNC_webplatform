import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

/** Form fields của POST /admin/shopee/import (multipart, ngoài part `file`). */
export class ShopeeImportDto {
  /** Shopee shop id (chuỗi số); bỏ trống thì lấy từ env SHOPEE_SHOP_ID. */
  @IsOptional()
  @Matches(/^\d{1,19}$/, { message: 'shopeeShopId must be a numeric Shopee shop id' })
  shopeeShopId?: string;

  /** Tên hiển thị của gian hàng; dùng khi shop được tạo lần đầu. */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  shopName?: string;
}