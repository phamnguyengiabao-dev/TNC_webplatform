import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

import { MAX_QUERY_LENGTH } from '../../catalog/catalog.constants';

/** GET /admin/shopee/items - hàng chờ để chọn đưa lên showroom. */
export class StagingQueryDto {
  @IsOptional()
  @IsIn(['NORMAL', 'UNLIST', 'BANNED', 'DELETED', 'NOT_SEEN'])
  status?: string;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_QUERY_LENGTH)
  q?: string;

  /** `linked=false` chỉ lấy item chưa lên showroom. */
  @IsOptional()
  @IsIn(['true', 'false'])
  linked?: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  take?: number;
}

/** GET /admin/products - danh sách curation, gồm cả bản nháp. */
export class AdminProductQueryDto {
  @IsOptional()
  @IsIn(['DRAFT', 'PUBLISHED', 'HIDDEN_BY_SYNC'])
  visibility?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  collection?: string;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_QUERY_LENGTH)
  q?: string;

  @IsOptional()
  @IsUUID()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  take?: number;
}
