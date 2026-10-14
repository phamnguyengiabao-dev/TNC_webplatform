import { Module } from '@nestjs/common';

import { CsvShopeeProvider } from './providers/csv/csv-shopee.provider';
import { AffiliateShopeeProvider } from './providers/affiliate/affiliate-shopee.provider';

/**
 * Provider đồng bộ Shopee. S2 chỉ có CSV (import tay từ Seller Center);
 * affiliate/open_platform bổ sung ở S4/S5 - cùng implement `ShopeeSyncProvider`
 * nên sync engine không phải đổi.
 */
@Module({
  providers: [CsvShopeeProvider, AffiliateShopeeProvider],
  exports: [CsvShopeeProvider, AffiliateShopeeProvider],
})
export class ShopeeModule {}
