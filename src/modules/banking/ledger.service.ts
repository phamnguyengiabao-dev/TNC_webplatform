import { Injectable, Logger } from '@nestjs/common';
import { Prisma, TransferKind, TransferStatus } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { Money, assertWholeDong, sumMoney, toNumericParam } from '../../common/money';
import {
  AlreadyReversedError,
  DuplicateLegError,
  InsufficientFundsError,
  LedgerError,
  SystemWalletMissingError,
  UnbalancedTransferError,
  WalletNotFoundError,
} from './ledger.errors';

/** Stable handles for the four system wallets seeded by finance_guards.sql. */
export const SYSTEM_WALLET = {
  ESCROW: 'ESCROW',
  PLATFORM_REVENUE: 'PLATFORM_REVENUE',
  GATEWAY_CLEARING: 'GATEWAY_CLEARING',
  WITHDRAWAL_CLEARING: 'WITHDRAWAL_CLEARING',
} as const;

export type SystemWalletCode = (typeof SYSTEM_WALLET)[keyof typeof SYSTEM_WALLET];

/** One signed leg. Negative debits the wallet, positive credits it. */
export interface TransferLeg {
  walletId: string;
  amount: Money;
}

export interface PostTransferInput {
  kind: TransferKind;
  /** Must be deterministic for the business event, e.g. `order-payment:<orderId>`. */
  idempotencyKey: string;
  legs: TransferLeg[];
  orderId?: string | null;
  externalRef?: string | null;
  description?: string | null;
  createdBy?: string | null;
}

interface GuardedUpdateRow {
  id: string;
  balance: Prisma.Decimal;
}

/**
 * The only component in the system allowed to move money.
 *
 * Nothing else may write to `Wallet.balance`, `LedgerTransfer` or
 * `LedgerEntry`. Enforce that in code review; the DB triggers in
 * prisma/sql/finance_guards.sql are the backstop.
 */
@Injectable()
export class LedgerService {
  private readonly logger = new Logger(LedgerService.name);

  /** System wallet ids never change, so resolve them once per process. */
  private readonly systemWalletIds = new Map<string, string>();

  constructor(private readonly prisma: PrismaService) {}

  async systemWalletId(code: SystemWalletCode): Promise<string> {
    const cached = this.systemWalletIds.get(code);
    if (cached) return cached;

    const wallet = await this.prisma.wallet.findUnique({
      where: { code },
      select: { id: true },
    });
    if (!wallet) throw new SystemWalletMissingError(code);

    this.systemWalletIds.set(code, wallet.id);
    return wallet.id;
  }

  async userWalletId(userId: string): Promise<string> {
    const wallet = await this.prisma.wallet.findUnique({
      where: { ownerId_currency: { ownerId: userId, currency: 'VND' } },
      select: { id: true },
    });
    // Wallets are provisioned by the auth.users trigger. A miss here means the
    // trigger is not installed, which is worth failing loudly over rather than
    // papering over with a lazy create that can race.
    if (!wallet) throw new WalletNotFoundError(`owner:${userId}`);
    return wallet.id;
  }

  /**
   * Post one balanced transfer. MUST be called inside an existing interactive
   * transaction so the money movement commits atomically with whatever business
   * state change caused it (order paid, withdrawal approved, ...).
   *
   * Each leg is applied with a single guarded UPDATE:
   *
   *   UPDATE "Wallet" SET balance = balance + :delta
   *    WHERE id = :id AND (kind <> 'USER' OR balance + :delta >= 0)
   *
   * This is the crucial difference from a `SELECT ... FOR UPDATE` followed by a
   * read, a comparison in JavaScript and then an UPDATE. Here the check and the
   * write are the same statement, evaluated by Postgres against the row it is
   * about to modify, so two concurrent payments cannot both observe a
   * sufficient balance. Zero affected rows means "insufficient funds or no such
   * wallet" and nothing has been written.
   */
  async post(tx: Prisma.TransactionClient, input: PostTransferInput): Promise<string> {
    this.validate(input);

    const transfer = await tx.ledgerTransfer.create({
      data: {
        kind: input.kind,
        status: TransferStatus.POSTED,
        idempotencyKey: input.idempotencyKey,
        orderId: input.orderId ?? null,
        externalRef: input.externalRef ?? null,
        description: input.description ?? null,
        createdBy: input.createdBy ?? null,
      },
      select: { id: true },
    });

    // A guarded UPDATE holds a row lock until commit. Applying legs in a
    // deterministic order means two transfers touching the same pair of wallets
    // acquire those locks in the same sequence and cannot deadlock each other.
    const legs = [...input.legs].sort((a, b) => (a.walletId < b.walletId ? -1 : 1));

    for (const leg of legs) {
      const delta = toNumericParam(leg.amount);

      const rows = await tx.$queryRaw<GuardedUpdateRow[]>`
        UPDATE "Wallet"
           SET balance     = balance + ${delta}::numeric,
               version     = version + 1,
               "updatedAt" = now()
         WHERE id = ${leg.walletId}::uuid
           AND (kind <> 'USER'::"WalletKind" OR balance + ${delta}::numeric >= 0)
        RETURNING id, balance
      `;

      if (rows.length !== 1) {
        throw await this.guardFailure(tx, leg);
      }

      await tx.ledgerEntry.create({
        data: {
          transferId: transfer.id,
          walletId: leg.walletId,
          amount: leg.amount,
          balanceAfter: rows[0].balance,
        },
      });
    }

    this.logger.log(
      `posted transfer ${transfer.id} kind=${input.kind} key=${input.idempotencyKey}`,
    );
    return transfer.id;
  }

  /**
   * Cancel a posted transfer by writing its mirror image. The original rows are
   * never touched: an auditor must be able to see that the mistake happened and
   * that it was corrected.
   */
  async reverse(
    tx: Prisma.TransactionClient,
    transferId: string,
    reason: string,
    actorId: string | null,
  ): Promise<string> {
    const original = await tx.ledgerTransfer.findUniqueOrThrow({
      where: { id: transferId },
      include: { entries: { select: { walletId: true, amount: true } } },
    });

    if (original.status === TransferStatus.REVERSED) {
      throw new AlreadyReversedError(transferId);
    }

    const reversalId = await this.post(tx, {
      kind: original.kind,
      idempotencyKey: `reversal:${transferId}`,
      orderId: original.orderId,
      externalRef: original.externalRef,
      description: `Reversal of ${transferId}: ${reason}`,
      createdBy: actorId,
      legs: original.entries.map((e) => ({
        walletId: e.walletId,
        amount: e.amount.neg(),
      })),
    });

    await tx.ledgerTransfer.update({
      where: { id: reversalId },
      data: { reversalOfId: transferId },
    });

    // Only `status` may change on a posted transfer; the DB trigger enforces it.
    await tx.ledgerTransfer.update({
      where: { id: transferId },
      data: { status: TransferStatus.REVERSED },
    });

    return reversalId;
  }

  /** Replay lookup for a webhook or a retried request. */
  findByIdempotencyKey(idempotencyKey: string) {
    return this.prisma.ledgerTransfer.findUnique({
      where: { idempotencyKey },
      include: { entries: true },
    });
  }

  static isIdempotencyReplay(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002' &&
      (error.meta?.target as string[] | undefined)?.includes('idempotencyKey') === true
    );
  }

  // ---------------------------------------------------------------------------

  private validate(input: PostTransferInput): void {
    const drift = sumMoney(input.legs.map((l) => l.amount));

    if (input.legs.length < 2 || !drift.isZero()) {
      // Fail before writing anything. The deferred DB trigger would catch this
      // at COMMIT anyway, but by then the error has lost all context.
      throw new UnbalancedTransferError(drift, input.legs.length);
    }

    const seen = new Set<string>();
    for (const leg of input.legs) {
      assertWholeDong(leg.amount, `leg[${leg.walletId}].amount`);
      if (leg.amount.isZero()) {
        throw new UnbalancedTransferError(drift, input.legs.length);
      }
      if (seen.has(leg.walletId)) throw new DuplicateLegError(leg.walletId);
      seen.add(leg.walletId);
    }
  }

  /**
   * Turns "zero rows affected" into a specific, actionable error. Returns the
   * error for the caller to `throw`, so control flow stays obvious to both the
   * reader and the type checker.
   */
  private async guardFailure(
    tx: Prisma.TransactionClient,
    leg: TransferLeg,
  ): Promise<LedgerError> {
    const wallet = await tx.wallet.findUnique({
      where: { id: leg.walletId },
      select: { id: true },
    });
    if (!wallet) return new WalletNotFoundError(leg.walletId);
    return new InsufficientFundsError(leg.walletId, leg.amount);
  }
}
