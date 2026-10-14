import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';

import { Public } from '../../common/auth/public.decorator';
import { CatalogService } from './catalog.service';
import { CatalogListQueryDto, RecordClickBodyDto } from './dto/catalog-query.dto';

/**
 * Read API công khai của showroom (docs 11.16).
 *
 * Toàn bộ controller là public: khách chưa đăng nhập vẫn xem và bấm mua được.
 * Không endpoint nào ở đây ghi vào dữ liệu thương mại - chỉ ghi nhận click ra
 * ngoài (analytics).
 */
@Controller('catalog')
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Public()
  @Get('collections')
  async listCollections() {
    return { items: await this.catalog.listCollections() };
  }

  @Public()
  @Get('products')
  listProducts(@Query() query: CatalogListQueryDto) {
    return this.catalog.listProducts(query);
  }

  @Public()
  @Get('products/:slug')
  detail(@Param('slug') slug: string) {
    return this.catalog.getProductBySlug(slug);
  }

  /**
   * Nút "Mua trên Shopee" dùng được cả khi JavaScript tắt: ghi nhận click rồi
   * 302 sang listing. Frontend nên trỏ thẳng href vào đây.
   */
  @Public()
  @Get('products/:id/buy')
  async buy(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const url = await this.catalog.resolveBuyUrl(id, clientContext(request));
    response.redirect(302, url);
  }

  /** Biến thể cho SPA: trả url để client tự mở tab mới. */
  @Public()
  @Post('products/:id/click')
  @HttpCode(200)
  async click(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: RecordClickBodyDto,
    @Req() request: Request,
  ) {
    const context = clientContext(request);
    const url = await this.catalog.resolveBuyUrl(id, {
      ...context,
      referrer: body.referrer ?? context.referrer,
    });
    return { url };
  }
}

function clientContext(request: Request): { ip?: string; userAgent?: string; referrer?: string } {
  const userAgent = request.headers['user-agent'];
  const referrer = request.headers.referer ?? request.headers.referrer;
  return {
    ip: request.ip ?? request.socket?.remoteAddress ?? undefined,
    userAgent: typeof userAgent === 'string' ? userAgent : undefined,
    referrer: typeof referrer === 'string' ? referrer : undefined,
  };
}
