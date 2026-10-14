import { Controller, Get, Query } from '@nestjs/common';

import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { RequireActiveAccount } from '../../common/auth/require-active-account.decorator';
import { StatementQueryDto } from './dto/statement-query.dto';
import { WalletService } from './wallet.service';

@RequireActiveAccount()
@Controller('wallet')
export class WalletController {
  constructor(private readonly wallet: WalletService) {}

  @Get()
  getWallet(@CurrentUser() user: AuthenticatedUser) {
    return this.wallet.getWallet(user.id);
  }

  @Get('statement')
  getStatement(@CurrentUser() user: AuthenticatedUser, @Query() query: StatementQueryDto) {
    return this.wallet.getStatement({
      userId: user.id,
      cursor: query.cursor,
      take: query.take,
    });
  }
}
