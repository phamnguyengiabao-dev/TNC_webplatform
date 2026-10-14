import {
  Body,
  Controller as NestController,
  Get,
  Controller,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';

import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { RequireActiveAccount } from '../../common/auth/require-active-account.decorator';
import { Roles } from '../../common/auth/roles.decorator';
import { AppError } from '../../common/errors/app-error';
import { Idempotent } from '../idempotency/idempotency.interceptor';
import { IMPORT_MAX_BYTES } from '../shopee/shopee.constants';
import { ShopeeImportDto } from './dto/shopee-import.dto';
import { SyncRunDto, SyncRunQueryDto } from './dto/sync-run.dto';
import { SyncService } from './sync.service';

/** File part do FileInterceptor (multer memoryStorage) gắn vào request. */
interface UploadedFilePart {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

/**
 * API vận hành đồng bộ Shopee (STAFF/ADMIN).
 *
 * Idempotency: `Idempotency-Key` là bắt buộc - retry mạng không được tạo hai
 * sync run. Lưu ý key gắn với form fields (không gồm nội dung file): muốn
 * import một file mới thì dùng key mới.
 */
@Controller('admin/shopee')
export class SyncAdminController {
  constructor(private readonly sync: SyncService) {}

  /** Upload file export từ Shopee Seller Center (Mass Upload -> Validate -> Export). */
  @Post('import')
  @HttpCode(200)
  @Idempotent()
  @Roles('STAFF', 'ADMIN')
  @RequireActiveAccount()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: IMPORT_MAX_BYTES, files: 1 } }))
  importCatalog(
    @UploadedFile() file: UploadedFilePart | undefined,
    @Body() body: ShopeeImportDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (!file) {
      throw AppError.validation(
        'multipart import without a "file" part',
        'Thiếu file import (form field "file").',
      );
    }
    return this.sync.importCsv({
      file: file.buffer,
      filename: file.originalname,
      actorId: user.id,
      shopeeShopId: body.shopeeShopId,
      shopName: body.shopName,
    });
  }
}

@NestController('admin/sync')
@Roles('STAFF', 'ADMIN')
@RequireActiveAccount()
export class SyncTriggerAdminController {
  constructor(private readonly sync: SyncService) {}

  @Post('run')
  @HttpCode(200)
  @Idempotent()
  run(@Body() body: SyncRunDto, @CurrentUser() user: AuthenticatedUser) {
    return this.sync.runAffiliate(user.id, body.mode);
  }

  @Get('runs')
  listRuns(@Query() query: SyncRunQueryDto) {
    return this.sync.listRuns(query);
  }

  @Get('runs/:id')
  getRun(@Param('id', ParseUUIDPipe) id: string) {
    return this.sync.getRun(id);
  }
}
