import { Module } from '@nestjs/common';

import { CatalogModule } from '../catalog/catalog.module';
import { ShopeeModule } from '../shopee/shopee.module';
import { SyncAdminController, SyncTriggerAdminController } from './sync-admin.controller';
import { SyncService } from './sync.service';
import { SyncSchedulerService } from './sync-scheduler.service';

/**
 * Sync engine + API vận hành (docs/backend/SHOPEE_SHOWROOM_BACKEND.md).
 *
 * Phụ thuộc CatalogModule để áp policy hiển thị (ẩn sản phẩm khi item
 * BANNED/DELETED/NOT_SEEN quá hạn) ngay sau khi ghi dữ liệu thương mại.
 */
@Module({
  imports: [ShopeeModule, CatalogModule],
  controllers: [SyncAdminController, SyncTriggerAdminController],
  providers: [SyncService, SyncSchedulerService],
  exports: [SyncService],
})
export class SyncModule {}
