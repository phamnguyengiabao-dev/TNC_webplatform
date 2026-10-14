import { Injectable } from '@nestjs/common';

import { CURRENCY, toJson } from '../../common/money';
import { AppError } from '../../common/errors/app-error';
import { PrismaService } from '../../prisma/prisma.service';

export interface MeView {
  id: string;
  email: string | null;
  displayName: string | null;
  role: string;
  isBlocked: boolean;
  wallet: { balance: string; currency: string } | null;
}

@Injectable()
export class IdentityService {
  constructor(private readonly prisma: PrismaService) {}

  async getMe(userId: string): Promise<MeView> {
    const profile = await this.prisma.userProfile.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        displayName: true,
        role: true,
        isBlocked: true,
        wallets: {
          where: { currency: CURRENCY },
          select: { balance: true, currency: true },
        },
      },
    });

    if (!profile) {
      // AuthGuard already read this row a moment ago; losing it here means the
      // account was deleted mid-request - worth a log line, not a 500.
      throw new AppError('PROFILE_NOT_FOUND', {
        logMessage: `UserProfile ${userId} disappeared during GET /me`,
      });
    }

    const wallet = profile.wallets[0];
    return {
      id: profile.id,
      email: profile.email,
      displayName: profile.displayName,
      role: profile.role,
      isBlocked: profile.isBlocked,
      wallet: wallet
        ? { balance: toJson(wallet.balance), currency: wallet.currency }
        : null,
    };
  }
}
