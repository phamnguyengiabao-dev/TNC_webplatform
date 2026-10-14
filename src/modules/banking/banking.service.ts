import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, TransferKind } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { Money, assertPositive, assertWholeDong, splitCommission } from '../../common/money';
import { EscrowEmptyError, InvalidStateTransitionError } from './ledger.errors';
import { LedgerService, SYSTEM_WALLET, TransferLeg } from './ledger.service';

interface OrderRow {
  id: string;
  buyerId: string;
  sellerId: string | null;
  grossAmount: Prisma.Decimal;
  commissionAmount: Prisma.Decimal;
}

interface WithdrawalRow {
  id: string;
  userId: string;
  amount: Prisma.Decimal;
}

/**
 * Shape of the second argument to `$transaction(fn, options)`. The Prisma
 * client declares it inline and exports no name for it, so it is mirrored
 * here; a mismatch is caught at the `$transaction` call sites.
 */
interface TxOptions {
  isolationLevel: Prisma.TransactionIsolationLevel;
  timeout: number;
  maxWait: number;
}

export interface PostResult {
  /** false means this was a replay and nothing new was written. */
  applied: boolean;
  transferId: string;
}

/**
 * Business flows for the internal wallet.
 *
 * The escrow model is what makes a C2C marketplace safe: the buyer's money
 * leaves their wallet at checkout but lands in ESCROW, not in the seller's
 * wallet. The seller is credited only once the order is delivered. Until then a
 * refund is a bookkeeping entry rather than a debt collection problem.
 *
 *   checkout   buyer        -gross   ->  ESCROW  +gross
 *   release    ESCROW       -gross   ->  seller  +(gross - commission)
 *                                        PLATFORM_REVENUE +commission
 *   refund     ESCROW       -gross   ->  buyer   +gross
 */
@Injectable()
export class BankingService {
  private readonly logger = new Logger(BankingService.name);

  /**
   * Interactive transactions occupy a pooled connection for their whole
   * duration, and on Supabase's transaction pooler that pool is small. Keep
   * these short, and never await an HTTP/PSP call inside one.
   */
  private readonly txOptions: TxOptions = {
    isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
    timeout: 15_000,
    maxWait: 5_000,
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly config: ConfigService,
  ) {}

  /** Default 5.00%. Override with APP_COMMISSION_BPS. Assumption, not a spec. */
  private get commissionBps(): number {
    return this.config.get<number>('app.commissionBps', 500);
  }

  // ---------------------------------------------------------------------------
  // Deposits
  // ---------------------------------------------------------------------------

  /**
   * Credit a user wallet after the payment provider confirmed a top-up.
   *
   * MUST only be called from a webhook handler that has already verified the
   * provider's signature and read `amount` out of the *provider's* payload. An
   * amount supplied by the client is an invitation to mint money.
   *
   * `gatewayRef` is the provider's own transaction id, which makes the
   * idempotency key deterministic: VNPay, MoMo and bank-polling services all
   * retry webhooks until they get a 2xx, and without this a single top-up would
   * be credited several times.
   */
  async confirmDeposit(input: {
    userId: string;
    amount: Money;
    gatewayRef: string;
  }): Promise<PostResult> {
    assertPositive(input.amount, 'amount');
    assertWholeDong(input.amount, 'amount');

    const key = `deposit:${input.gatewayRef}`;
    const [userWallet, gateway] = await Promise.all([
      this.ledger.userWalletId(input.userId),
      this.ledger.systemWalletId(SYSTEM_WALLET.GATEWAY_CLEARING),
    ]);

    return this.once(key, () =>
      this.prisma.$transaction(
        (tx) =>
          this.ledger.post(tx, {
            kind: TransferKind.DEPOSIT,
            idempotencyKey: key,
            externalRef: input.gatewayRef,
            description: 'Wallet top-up',
            createdBy: input.userId,
            legs: [
              { walletId: gateway, amount: input.amount.neg() },
              { walletId: userWallet, amount: input.amount },
            ],
          }),
        this.txOptions,
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // Order payment / release / refund
  // ---------------------------------------------------------------------------

  /**
   * Move the buyer's money into escrow and mark the order paid, atomically.
   *
   * The order transition is a guarded UPDATE with `RETURNING`, so the status
   * check, the status change and the read of the authoritative amounts are one
   * statement. A second request for the same order affects zero rows and is
   * rejected instead of taking the money twice.
   */
  async payForOrder(input: { orderId: string; buyerId: string }): Promise<PostResult> {
    const key = `order-payment:${input.orderId}`;
    const escrow = await this.ledger.systemWalletId(SYSTEM_WALLET.ESCROW);
    const buyerWallet = await this.ledger.userWalletId(input.buyerId);

    return this.once(key, () =>
      this.prisma.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<OrderRow[]>`
          UPDATE "Order"
             SET status      = 'PAID'::"OrderStatus",
                 "paidAt"    = now(),
                 version     = version + 1,
                 "updatedAt" = now()
           WHERE id        = ${input.orderId}::uuid
             AND "buyerId" = ${input.buyerId}::uuid
             AND status    = 'PENDING_PAYMENT'::"OrderStatus"
          RETURNING id, "buyerId", "sellerId", "grossAmount", "commissionAmount"
        `;

        if (rows.length !== 1) {
          throw new InvalidStateTransitionError('Order', input.orderId, 'PENDING_PAYMENT');
        }
        const order = rows[0];

        await this.ledger.post(tx, {
          kind: TransferKind.ORDER_PAYMENT,
          idempotencyKey: key,
          orderId: order.id,
          description: `Payment for order ${order.id}`,
          createdBy: input.buyerId,
          legs: [
            { walletId: buyerWallet, amount: order.grossAmount.neg() },
            { walletId: escrow, amount: order.grossAmount },
          ],
        });
      }, this.txOptions),
    );
  }

  /**
   * Release escrow to the seller once the order is delivered, taking commission.
   *
   * Only `DELIVERED` orders can be released. Releasing earlier would hand the
   * money over before the buyer has anything in their hands, which defeats the
   * point of holding it.
   */
  async releaseOrder(input: { orderId: string; actorId: string }): Promise<PostResult> {
    const key = `order-release:${input.orderId}`;
    const [escrow, revenue] = await Promise.all([
      this.ledger.systemWalletId(SYSTEM_WALLET.ESCROW),
      this.ledger.systemWalletId(SYSTEM_WALLET.PLATFORM_REVENUE),
    ]);

    return this.once(key, () =>
      this.prisma.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<OrderRow[]>`
          UPDATE "Order"
             SET status       = 'COMPLETED'::"OrderStatus",
                 "releasedAt" = now(),
                 version      = version + 1,
                 "updatedAt"  = now()
           WHERE id     = ${input.orderId}::uuid
             AND status = 'DELIVERED'::"OrderStatus"
          RETURNING id, "buyerId", "sellerId", "grossAmount", "commissionAmount"
        `;

        if (rows.length !== 1) {
          throw new InvalidStateTransitionError('Order', input.orderId, 'DELIVERED');
        }
        const order = rows[0];
        await this.assertEscrowHolds(tx, order.id, escrow, order.grossAmount);

        const legs: TransferLeg[] = [
          { walletId: escrow, amount: order.grossAmount.neg() },
        ];

        if (order.sellerId === null) {
          // First-party retail: TNC is the seller, so the whole amount is ours.
          legs.push({ walletId: revenue, amount: order.grossAmount });
        } else {
          const sellerAmount = order.grossAmount.sub(order.commissionAmount);
          const sellerWallet = await this.ledger.userWalletId(order.sellerId);

          // Zero-amount legs are rejected by the ledger, so a 0% commission
          // order simply has no revenue leg.
          if (sellerAmount.greaterThan(0)) {
            legs.push({ walletId: sellerWallet, amount: sellerAmount });
          }
          if (order.commissionAmount.greaterThan(0)) {
            legs.push({ walletId: revenue, amount: order.commissionAmount });
          }
        }

        await this.ledger.post(tx, {
          kind: TransferKind.ORDER_RELEASE,
          idempotencyKey: key,
          orderId: order.id,
          description: `Escrow release for order ${order.id}`,
          createdBy: input.actorId,
          legs,
        });
      }, this.txOptions),
    );
  }

  /** Return escrowed money to the buyer. Cancellation or resolved dispute. */
  async refundOrder(input: {
    orderId: string;
    actorId: string;
    reason: string;
  }): Promise<PostResult> {
    const key = `order-refund:${input.orderId}`;
    const escrow = await this.ledger.systemWalletId(SYSTEM_WALLET.ESCROW);

    return this.once(key, () =>
      this.prisma.$transaction(async (tx) => {
        // Refundable only while the money is still in escrow, i.e. after
        // payment and before release.
        const rows = await tx.$queryRaw<OrderRow[]>`
          UPDATE "Order"
             SET status      = 'REFUNDED'::"OrderStatus",
                 version     = version + 1,
                 "updatedAt" = now()
           WHERE id     = ${input.orderId}::uuid
             AND status IN (
                   'PAID'::"OrderStatus",
                   'READY_TO_SHIP'::"OrderStatus",
                   'SHIPPED'::"OrderStatus",
                   'DELIVERED'::"OrderStatus",
                   'DISPUTED'::"OrderStatus"
                 )
          RETURNING id, "buyerId", "sellerId", "grossAmount", "commissionAmount"
        `;

        if (rows.length !== 1) {
          throw new InvalidStateTransitionError('Order', input.orderId, 'PAID..DISPUTED');
        }
        const order = rows[0];
        await this.assertEscrowHolds(tx, order.id, escrow, order.grossAmount);
        const buyerWallet = await this.ledger.userWalletId(order.buyerId);

        await this.ledger.post(tx, {
          kind: TransferKind.ORDER_REFUND,
          idempotencyKey: key,
          orderId: order.id,
          description: `Refund for order ${order.id}: ${input.reason}`,
          createdBy: input.actorId,
          legs: [
            { walletId: escrow, amount: order.grossAmount.neg() },
            { walletId: buyerWallet, amount: order.grossAmount },
          ],
        });
      }, this.txOptions),
    );
  }

  /**
   * Freeze the commission for an order at checkout time.
   *
   * Store the result on the order rather than recomputing at release: a later
   * change to the commission rate must not retroactively alter money owed on
   * orders that were already agreed.
   */
  quoteOrder(gross: Money): { commission: Money; sellerAmount: Money } {
    return splitCommission(gross, this.commissionBps);
  }

  // ---------------------------------------------------------------------------
  // Withdrawals
  // ---------------------------------------------------------------------------

  /**
   * Approve a withdrawal and debit the user immediately.
   *
   * The debit happens now, not when the bank transfer succeeds. If we waited,
   * the user could spend or withdraw the same balance again while the transfer
   * was in flight. The money is parked in WITHDRAWAL_CLEARING, which is exactly
   * "money we have promised to a bank but not yet sent".
   *
   * If the balance is short, the guarded UPDATE affects zero rows, the
   * transaction rolls back and the request stays REQUESTED.
   */
  async approveWithdrawal(input: {
    requestId: string;
    staffId: string;
  }): Promise<PostResult> {
    const key = `withdrawal-approve:${input.requestId}`;
    const clearing = await this.ledger.systemWalletId(SYSTEM_WALLET.WITHDRAWAL_CLEARING);

    return this.once(key, () =>
      this.prisma.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<WithdrawalRow[]>`
          UPDATE "WithdrawalRequest"
             SET status       = 'APPROVED'::"WithdrawalStatus",
                 "reviewedBy" = ${input.staffId}::uuid,
                 "reviewedAt" = now(),
                 "updatedAt"  = now()
           WHERE id     = ${input.requestId}::uuid
             AND status = 'REQUESTED'::"WithdrawalStatus"
          RETURNING id, "userId", amount
        `;

        if (rows.length !== 1) {
          throw new InvalidStateTransitionError(
            'WithdrawalRequest',
            input.requestId,
            'REQUESTED',
          );
        }
        const request = rows[0];
        const userWallet = await this.ledger.userWalletId(request.userId);

        await this.ledger.post(tx, {
          kind: TransferKind.WITHDRAWAL_REQUEST,
          idempotencyKey: key,
          description: `Withdrawal ${request.id} approved`,
          createdBy: input.staffId,
          legs: [
            { walletId: userWallet, amount: request.amount.neg() },
            { walletId: clearing, amount: request.amount },
          ],
        });
      }, this.txOptions),
    );
  }

  /** The bank confirmed the transfer: the money has left the system for good. */
  async settleWithdrawal(input: {
    requestId: string;
    bankRef: string;
    actorId: string;
  }): Promise<PostResult> {
    const key = `withdrawal-settle:${input.requestId}`;
    const [clearing, gateway] = await Promise.all([
      this.ledger.systemWalletId(SYSTEM_WALLET.WITHDRAWAL_CLEARING),
      this.ledger.systemWalletId(SYSTEM_WALLET.GATEWAY_CLEARING),
    ]);

    return this.once(key, () =>
      this.prisma.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<WithdrawalRow[]>`
          UPDATE "WithdrawalRequest"
             SET status      = 'SETTLED'::"WithdrawalStatus",
                 "updatedAt" = now()
           WHERE id     = ${input.requestId}::uuid
             AND status = 'APPROVED'::"WithdrawalStatus"
          RETURNING id, "userId", amount
        `;

        if (rows.length !== 1) {
          throw new InvalidStateTransitionError(
            'WithdrawalRequest',
            input.requestId,
            'APPROVED',
          );
        }

        await this.ledger.post(tx, {
          kind: TransferKind.WITHDRAWAL_SETTLED,
          idempotencyKey: key,
          externalRef: input.bankRef,
          description: `Withdrawal ${input.requestId} settled`,
          createdBy: input.actorId,
          legs: [
            { walletId: clearing, amount: rows[0].amount.neg() },
            { walletId: gateway, amount: rows[0].amount },
          ],
        });
      }, this.txOptions),
    );
  }

  /**
   * The bank rejected the transfer after we had already debited the user.
   * Reverse the approval transfer so the money reappears in their wallet, and
   * leave both the original and the reversal in the ledger.
   */
  async failWithdrawal(input: {
    requestId: string;
    reason: string;
    actorId: string;
  }): Promise<string> {
    const approvalKey = `withdrawal-approve:${input.requestId}`;

    return this.prisma.$transaction(async (tx) => {
      const affected = await tx.$executeRaw`
        UPDATE "WithdrawalRequest"
           SET status      = 'FAILED'::"WithdrawalStatus",
               reason      = ${input.reason},
               "updatedAt" = now()
         WHERE id     = ${input.requestId}::uuid
           AND status = 'APPROVED'::"WithdrawalStatus"
      `;
      if (affected !== 1) {
        throw new InvalidStateTransitionError(
          'WithdrawalRequest',
          input.requestId,
          'APPROVED',
        );
      }

      const approval = await tx.ledgerTransfer.findUniqueOrThrow({
        where: { idempotencyKey: approvalKey },
        select: { id: true },
      });

      return this.ledger.reverse(tx, approval.id, input.reason, input.actorId);
    }, this.txOptions);
  }

  // ---------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------

  async getBalance(userId: string): Promise<Money> {
    const wallet = await this.prisma.wallet.findUniqueOrThrow({
      where: { ownerId_currency: { ownerId: userId, currency: 'VND' } },
      select: { balance: true },
    });
    return wallet.balance;
  }

  /**
   * Keyset pagination. OFFSET gets slower the deeper you page and can skip or
   * repeat rows when new entries arrive mid-pagination, which is unacceptable
   * for a statement the user may be reconciling by hand.
   */
  async getStatement(input: { userId: string; cursorId?: string; take?: number }) {
    const take = Math.min(input.take ?? 20, 100);
    const walletId = await this.ledger.userWalletId(input.userId);

    return this.prisma.ledgerEntry.findMany({
      where: { walletId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take,
      ...(input.cursorId ? { cursor: { id: input.cursorId }, skip: 1 } : {}),
      include: {
        transfer: {
          select: { kind: true, description: true, orderId: true, externalRef: true },
        },
      },
    });
  }

  /**
   * Cached balances versus the ledger. Run on a schedule and alert on any
   * non-zero drift; also assert this returns an empty array in integration
   * tests, which is the cheapest possible proof that the money logic is sound.
   */
  async findBalanceDrift(): Promise<
    Array<{ wallet_id: string; cached_balance: Prisma.Decimal; drift: Prisma.Decimal }>
  > {
    return this.prisma.$queryRaw`
      SELECT wallet_id, cached_balance, drift
        FROM "WalletReconciliation"
       WHERE drift <> 0
    `;
  }

  // ---------------------------------------------------------------------------

  /**
   * Escrow is one shared wallet, so a *global* balance check cannot stop one
   * order from draining funds that belong to another. This looks only at the
   * legs of THIS order's transfers: money may be released or refunded only up
   * to what was actually paid in for this order.
   */
  private async assertEscrowHolds(
    tx: Prisma.TransactionClient,
    orderId: string,
    escrowWalletId: string,
    required: Prisma.Decimal,
  ): Promise<void> {
    const rows = await tx.$queryRaw<Array<{ held: Prisma.Decimal }>>`
      SELECT coalesce(sum(e.amount), 0) AS held
        FROM "LedgerEntry" e
        JOIN "LedgerTransfer" t ON t.id = e."transferId"
       WHERE t."orderId" = ${orderId}::uuid
         AND e."walletId" = ${escrowWalletId}::uuid
    `;

    if (rows[0].held.lessThan(required)) {
      throw new EscrowEmptyError(orderId);
    }
  }

  /**
   * Run `work` unless this idempotency key has already produced a transfer.
   *
   * Both halves are necessary: the pre-check answers the ordinary retry
   * cheaply, and the catch path covers the race where two retries arrive
   * close enough together that both pass the pre-check. The unique index on
   * `LedgerTransfer.idempotencyKey` is what actually decides the winner.
   */
  private async once(
    idempotencyKey: string,
    work: () => Promise<unknown>,
  ): Promise<PostResult> {
    const existing = await this.prisma.ledgerTransfer.findUnique({
      where: { idempotencyKey },
      select: { id: true },
    });
    if (existing) {
      this.logger.log(`replay for ${idempotencyKey}, nothing written`);
      return { applied: false, transferId: existing.id };
    }

    try {
      await work();
    } catch (error) {
      // Failing does not prove nothing was written: a concurrent request may
      // have completed the same business event a moment earlier. That shows
      // up either as a raw duplicate-key race (P2002 from the idempotencyKey
      // unique index) or as a guarded state transition that affected zero
      // rows because the winner had already committed. The unique index is
      // the arbiter, so re-check it before rethrowing.
      const winner = await this.prisma.ledgerTransfer.findUnique({
        where: { idempotencyKey },
        select: { id: true },
      });
      if (!winner) throw error;

      this.logger.log(
        `concurrent replay for ${idempotencyKey}${
          LedgerService.isIdempotencyReplay(error) ? ' (P2002)' : ''
        }, nothing written`,
      );
      return { applied: false, transferId: winner.id };
    }

    const posted = await this.prisma.ledgerTransfer.findUniqueOrThrow({
      where: { idempotencyKey },
      select: { id: true },
    });
    return { applied: true, transferId: posted.id };
  }
}
