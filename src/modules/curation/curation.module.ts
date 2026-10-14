import { Module } from '@nestjs/common';

import { CatalogModule } from '../catalog/catalog.module';
import { CurationAdminController } from './curation-admin.controller';
import { CurationService } from './curation.service';

/**
 * Curation (staff): gắn item Shopee lên showroom, viết copy, publish/unpublish.
 * Đọc policy hiển thị từ CatalogModule để không lặp lại luật.
 */
@Module({
  imports: [CatalogModule],
  controllers: [CurationAdminController],
  providers: [CurationService],
  exports: [CurationService],
})
export class CurationModule {}
