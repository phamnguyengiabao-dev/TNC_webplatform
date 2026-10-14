import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { SyncService } from './sync.service';

/** Optional process-local refresh timer; external schedulers can call the same API. */
@Injectable()
export class SyncSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SyncSchedulerService.name);
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly config: ConfigService,
    private readonly sync: SyncService,
  ) {}

  onModuleInit(): void {
    const provider = this.config.get<string>('shopee.provider', 'csv');
    const appId = this.config.get<string>('shopee.affiliateAppId', '').trim();
    const secret = this.config.get<string>('shopee.affiliateSecret', '');
    const shopId = this.config.get<string>('shopee.shopId', '').trim();
    if (provider !== 'affiliate' || !appId || !secret || !/^\d{1,19}$/.test(shopId)) return;

    const interval = Math.max(15 * 60 * 1000, this.config.get<number>('shopee.affiliateRefreshIntervalMs', 4 * 60 * 60 * 1000));
    this.timer = setInterval(() => {
      void this.sync.runAffiliate(null, 'incremental').catch((error: unknown) => {
        this.logger.error(`scheduled Shopee Affiliate sync failed: ${error instanceof Error ? error.message : String(error)}`);
      });
    }, interval);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
