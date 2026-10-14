import { Controller, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';

import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { RequireActiveAccount } from '../../common/auth/require-active-account.decorator';
import { Idempotent } from '../idempotency/idempotency.interceptor';
import { OrdersService } from './orders.service';

@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  /**
   * Idempotency-Key is mandatory: a double-click or a network retry must not
   * attempt a second payment. POST (not PUT) keeps the door open for a body,
   * but today the only input is the order id in the path.
   */
  @Post(':id/pay-wallet')
  @HttpCode(200)
  @Idempotent()
  @RequireActiveAccount()
  payWallet(
    @Param('id', new ParseUUIDPipe()) orderId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.orders.payWithWallet({ orderId, user });
  }
}
