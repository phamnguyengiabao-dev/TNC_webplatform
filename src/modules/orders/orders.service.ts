import { Injectable, Logger } from '@nestjs/common';

import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { AppError } from '../../common/errors/app-error';
import { PrismaService } from '../../prisma/prisma.service';
import { BankingService } from '../banking/banking.service';

export interface PayWithWalletResult {
  orderId: string;
  status: string;
  paidAt: string | null;
  transferId: string;
  /** false when this call replayed an earlier payment (ledger idempotency). */
  applied: boolean;
}

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly banking: BankingService,
  ) {}

  /**
   * Pay for an order from the internal wallet.
   *
   * Ownership is checked here, before BankingService: the ledger's guarded
   * UPDATE filters on `buyerId` too, but it reports "wrong state" for a
   * non-owner, and the API contract distinguishes 403 from 409 (docs 11.6.2).
   */
  async payWithWallet(input: {
    orderId: string;
    user: AuthenticatedUser;
  }): Promise<PayWithWalletResult> {
    const order = await this.prisma.order.findUnique({
      where: { id: input.orderId },
      select: { id: true, buyerId: true },
    });
    if (!order) {
      throw AppError.notFound(`order ${input.orderId} not found`, 'Không tìm thấy đơn hàng.');
    }
    if (order.buyerId !== input.user.id) {
      throw AppError.forbidden(
        `user ${input.user.id} is not the buyer of order ${order.id}`,
        'Bạn không phải người mua của đơn hàng này.',
      );
    }

    const result = await this.banking.payForOrder({
      orderId: order.id,
      buyerId: input.user.id,
    });

    // Re-read rather than guess: on a replay the original paidAt must be
    // returned, not `now`.
    const paid = await this.prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      select: { id: true, status: true, paidAt: true },
    });

    return {
      orderId: paid.id,
      status: paid.status,
      paidAt: paid.paidAt?.toISOString() ?? null,
      transferId: result.transferId,
      applied: result.applied,
    };
  }
}
