import { Module } from '@nestjs/common';

import { CatalogAvailabilityService } from './catalog-availability.service';
import { CatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';

/**
 * Showroom read model + policy hiển thị.
 *
 * CatalogAvailabilityService được export để sync áp policy sau mỗi lần đồng
 * bộ (chiều phụ thuộc: sync -> catalog, không bao giờ ngược lại).
 */
@Module({
  controllers: [CatalogController],
  providers: [CatalogService, CatalogAvailabilityService],
  exports: [CatalogService, CatalogAvailabilityService],
})
export class CatalogModule {}
