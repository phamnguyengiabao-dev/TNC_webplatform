import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  IsUrl,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { SEAL_STATUSES, type SealStatus } from '../../catalog/catalog.constants';

/** Badge tự do của staff; frontend tự ghép nhãn từ condition + seal. */
const MAX_BADGES = 6;
const MAX_BADGE_LENGTH = 40;

/** POST /admin/products - gắn một item Shopee lên showroom. */
export class CreateProductDto {
  /** Id nội bộ của ShopeeItem (không phải item_id của Shopee). */
  @IsOptional()
  @IsUUID()
  shopeeItemId?: string;

  @IsString()
  @MaxLength(80)
  collectionSlug!: string;

  /** Bỏ trống thì sinh từ tên sản phẩm. */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  slug?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  displayTitle?: string;

  @IsOptional()
  @IsString()
  @MaxLength(600)
  blurb?: string;

  /** Pre-loved: % dung tích còn lại (1..100). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  conditionPercent?: number;

  @IsOptional()
  @IsIn(SEAL_STATUSES)
  sealStatus?: SealStatus;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_BADGES)
  @IsString({ each: true })
  @MaxLength(MAX_BADGE_LENGTH, { each: true })
  badges?: string[];

  /** Khối trust: { sterilized, origin, authenticity, expiresOn, ... }. */
  @IsOptional()
  @IsObject()
  qaNotes?: Record<string, unknown>;

  /** Link affiliate hoặc link liên hệ cho món không có listing Shopee riêng. */
  @IsOptional()
  @IsUrl({ require_tld: false, protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(1000)
  buyUrlOverride?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10_000)
  featuredRank?: number;
}

/** PATCH /admin/products/{id} - mọi field đều tuỳ chọn. */
export class UpdateProductDto {
  @IsOptional()
  @IsUUID()
  shopeeItemId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  collectionSlug?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  slug?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  displayTitle?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(600)
  blurb?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  conditionPercent?: number;

  @IsOptional()
  @IsIn(SEAL_STATUSES)
  sealStatus?: SealStatus | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_BADGES)
  @IsString({ each: true })
  @MaxLength(MAX_BADGE_LENGTH, { each: true })
  badges?: string[];

  @IsOptional()
  @IsObject()
  qaNotes?: Record<string, unknown> | null;

  @IsOptional()
  @IsUrl({ require_tld: false, protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(1000)
  buyUrlOverride?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10_000)
  featuredRank?: number;
}
