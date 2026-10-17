import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { SocialMediaVisibility } from '@prisma/client';

import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { Public } from '../../common/auth/public.decorator';
import { RequireActiveAccount } from '../../common/auth/require-active-account.decorator';
import { Roles } from '../../common/auth/roles.decorator';
import { Idempotent } from '../idempotency/idempotency.interceptor';
import { AppError } from '../../common/errors/app-error';
import { MetaSocialSyncService } from './meta-social-sync.service';
import { SetSocialMediaVisibilityDto } from './social-media.dto';

@Controller('social-media')
export class SocialMediaPublicController {
  constructor(private readonly social: MetaSocialSyncService) {}

  @Get()
  @Public()
  listPublic() { return this.social.listPublic(); }
}

@Controller('admin/social-media')
@Roles('ADMIN')
@RequireActiveAccount()
export class SocialMediaAdminController {
  constructor(private readonly social: MetaSocialSyncService) {}

  @Get()
  list(@Query('visibility') visibility?: SocialMediaVisibility) {
    if (visibility && !Object.values(SocialMediaVisibility).includes(visibility)) {
      throw AppError.validation('invalid social media visibility filter', 'Trạng thái lọc không hợp lệ.');
    }
    return this.social.listAdmin(visibility);
  }

  @Post('sync')
  @HttpCode(200)
  @Idempotent()
  sync(@CurrentUser() user: AuthenticatedUser) { return this.social.sync(user.id); }

  @Patch(':id/visibility')
  setVisibility(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: SetSocialMediaVisibilityDto,
    @CurrentUser() user: AuthenticatedUser,
  ) { return this.social.setVisibility(id, body.visibility, user.id, body.selectedMediaUrls); }
}
