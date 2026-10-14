import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

import { CATALOG_SORTS, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, MAX_QUERY_LENGTH, type CatalogSort } from '../catalog.constants';

/** Query contract for GET /catalog/products (docs 11.16). */
export class CatalogListQueryDto {
  /** Slug của collection (`pristine-retail` | `curated-preloved`). */
  @IsOptional()
  @IsString()
  @MaxLength(80)
  collection?: string;

  /** Tìm theo tên hiển thị (showroom) và tên gốc trên Shopee. */
  @IsOptional()
  @IsString()
  @MaxLength(MAX_QUERY_LENGTH)
  q?: string;

  @IsOptional()
  @IsIn(CATALOG_SORTS)
  sort?: CatalogSort;

  /** Pre-loved: chỉ lấy món còn lại ít nhất bao nhiêu %. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  condition_min?: number;

  /** Giá VND, chuỗi số nguyên (không có phần thập phân). */
  @IsOptional()
  @Matches(/^\d{1,12}$/, { message: 'price_min must be a whole VND amount' })
  price_min?: string;

  @IsOptional()
  @Matches(/^\d{1,12}$/, { message: 'price_max must be a whole VND amount' })
  price_max?: string;

  @IsOptional()
  @IsIn(['true', 'false'])
  in_stock?: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  take?: number;

  get pageSize(): number {
    return this.take ?? DEFAULT_PAGE_SIZE;
  }

  get wantsInStock(): boolean | undefined {
    return this.in_stock === undefined ? undefined : this.in_stock === 'true';
  }
}

/** Query contract for POST-free SPA click tracking. */
export class RecordClickBodyDto {
  /** Nơi click xuất phát, do client gửi kèm khi fetch từ SPA. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  referrer?: string;
}
