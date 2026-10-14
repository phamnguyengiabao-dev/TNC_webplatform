import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';

import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { RequireActiveAccount } from '../../common/auth/require-active-account.decorator';
import { Roles } from '../../common/auth/roles.decorator';
import { Idempotent } from '../idempotency/idempotency.interceptor';
import { CurationService } from './curation.service';
import { CreateProductDto, UpdateProductDto } from './dto/product-write.dto';
import { AdminProductQueryDto, StagingQueryDto } from './dto/staging-query.dto';

/**
 * API curation cho staff (docs 11.17).
 *
 * Mọi POST mang `Idempotency-Key`: bấm publish hai lần hay retry mạng không
 * được tạo hai thao tác. PATCH không cần vì tự nó đã idempotent theo HTTP.
 */
@Controller('admin')
@Roles('STAFF', 'ADMIN')
@RequireActiveAccount()
export class CurationAdminController {
  constructor(private readonly curation: CurationService) {}

  /** Hàng chờ: item đã sync về, chọn cái nào đưa lên showroom. */
  @Get('shopee/items')
  listStagingItems(@Query() query: StagingQueryDto) {
    return this.curation.listStagingItems(query);
  }

  /** Danh sách sản phẩm showroom, gồm cả bản nháp và bản bị sync ẩn. */
  @Get('products')
  listProducts(@Query() query: AdminProductQueryDto) {
    return this.curation.listProducts(query);
  }

  @Post('products')
  @Idempotent()
  createProduct(@Body() dto: CreateProductDto, @CurrentUser() user: AuthenticatedUser) {
    return this.curation.createProduct(dto, user.id);
  }

  @Patch('products/:id')
  updateProduct(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProductDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.curation.updateProduct(id, dto, user.id);
  }

  @Post('products/:id/publish')
  @HttpCode(200)
  @Idempotent()
  publish(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.curation.publish(id, user.id);
  }

  @Post('products/:id/unpublish')
  @HttpCode(200)
  @Idempotent()
  unpublish(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.curation.unpublish(id, user.id);
  }
}
