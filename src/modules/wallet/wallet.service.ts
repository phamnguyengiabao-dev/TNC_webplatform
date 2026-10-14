import { Injectable } from '@nestjs/common';

import { CURRENCY, toJson } from '../../common/money';
import { AppError } from '../../common/errors/app-error';
import { PrismaService } from '../../prisma/prisma.service';
import { BankingService } from '../banking/banking.service';

export interface WalletView {
  balance: string;
  currency: string;
  updatedAt: string;
}

export interface StatementItem {
  id: string;
  kind: string;
  description: string | null;
  /** Signed: negative is a debit. Always a string - see common/money.ts. */
  amount: string;
  balanceAfter: string;
  orderId: string | null;
  createdAt: string;
}

export interface StatementPage {
  data: StatementItem[];
  nextCursor: string | null;
}

/**
 * Read-side of the wallet. Writes stay in BankingService; this service only
 * shapes rows into the API contract (amounts as strings, camelCase keys).
 */
@Injectable()
export class WalletService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly banking: BankingService,
  ) {}

  async getWallet(userId: string): Promise<WalletView> {
    const wallet = await this.prisma.wallet.findUnique({
      where: { ownerId_currency: { ownerId: userId, currency: CURRENCY } },
      select: { balance: true, currency: true, updatedAt: true },
    });
    if (!wallet) {
      // The signup trigger provisions the wallet; missing means provisioning
      // broke, which is an operational error (500), not a user error.
      throw new AppError('WALLET_NOT_FOUND', {
        logMessage: `user ${userId} has no ${CURRENCY} wallet`,
      });
    }

    return {
      balance: toJson(wallet.balance),
      currency: wallet.currency,
      updatedAt: wallet.updatedAt.toISOString(),
    };
  }

  async getStatement(input: {
    userId: string;
    cursor?: string;
    take?: number;
  }): Promise<StatementPage> {
    const take = input.take ?? 20;
    const entries = await this.banking.getStatement({
      userId: input.userId,
      cursorId: input.cursor,
      take,
    });

    const data = entries.map((entry) => ({
      id: entry.id,
      kind: entry.transfer.kind,
      description: entry.transfer.description,
      amount: toJson(entry.amount),
      balanceAfter: toJson(entry.balanceAfter),
      orderId: entry.transfer.orderId,
      createdAt: entry.createdAt.toISOString(),
    }));

    // A short page means the cursor reached the end; otherwise the last id is
    // the cursor for the next page.
    const last = data[data.length - 1];
    return { data, nextCursor: data.length === take && last ? last.id : null };
  }
}
