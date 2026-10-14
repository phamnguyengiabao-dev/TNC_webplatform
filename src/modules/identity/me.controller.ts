import { Controller, Get } from '@nestjs/common';

import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { IdentityService } from './identity.service';

@Controller('me')
export class MeController {
  constructor(private readonly identity: IdentityService) {}

  /** Profile + role + wallet summary; the frontend's first call after login. */
  @Get()
  getMe(@CurrentUser() user: AuthenticatedUser) {
    return this.identity.getMe(user.id);
  }
}
