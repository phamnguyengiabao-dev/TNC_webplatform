import { Module } from '@nestjs/common';

import { SocialMediaAdminController, SocialMediaPublicController } from './social-media.controller';
import { MetaSocialSyncService } from './meta-social-sync.service';

@Module({
  controllers: [SocialMediaPublicController, SocialMediaAdminController],
  providers: [MetaSocialSyncService],
})
export class SocialMediaModule {}
