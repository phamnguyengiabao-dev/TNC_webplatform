import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';

import { money } from '../src/common/money';
import { BankingService } from '../src/modules/banking/banking.service';
import { InsufficientFundsError, InvalidStateTransitionError, EscrowEmptyError } from '../src/modules/banking/ledger.errors';
import { LedgerService } from '../src/modules/banking/ledger.service';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  configWithCommissionBps,
  createPrismaService,
  resetDatabase,
  seedOrder,
  seedPaidWithdrawal,
  seedUser,
  systemBalance,
  userBalance,
} from './helpers/test-db';

describe('BankingService', () => {
  let prisma: PrismaService;
  let ledger: LedgerService;
  let banking: BankingService;
  let buyerId: string;
  let sellerId: string;

  const dong = (value: Prisma.Decimal | string) =>
    typeof value === 'string' ? value : value.toFixed(0);

  const fund = (amount: string, userId = buyerId) =>
    banking.confirmDeposit({ userId, amount: money(amount), gatewayRef: `psp-${randomUUID()}` });

  const setOrderStatus = (orderId: string, status: 'SHIPPED' | 'DELIVERED' | 'PAID') =>
    prisma.order.update({ where: { id: orderId }, data: { status } });

  beforeAll(async () => {
    prisma = createPrismaService();
    await prisma.$connect();
    ledger = new LedgerService(prisma);
    banking = new BankingService(prisma, ledger, configWithCommissionBps(500));
  });

  afterAll(async () => {
    // Cheap global proof that nothing in this suite corrupted the books.
    expect(await banking.findBalanceDrift()).toEqual([]);
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    buyerId = await seedUser(prisma, 'buyer@test.local');
    sellerId = await seedUser(prisma, 'seller@test.local');
  });

  // ---------------------------------------------------------------------------
  // Signup provisioning
  // ---------------------------------------------------------------------------

  it('provisions UserProfile and the VND wallet from the auth.users trigger', async () => {
    const id = await seedUser(prisma, 'fresh@test.local');
    expect(await prisma.userProfile.findUnique({ where: { id } })).not.toBeNull();
    expect(
      await prisma.wallet.findUnique({ where: { ownerId_currency: { ownerId: id, currency: 'VND' } } }),
    ).not.toBeNull();
  });

  it('freezes the commission using the configured rate', () => {
    const withFivePercent = banking.quoteOrder(money('100000'));
    expect(dong(withFivePercent.commission)).toBe('5000');
    expect(dong(withFivePercent.sellerAmount)).toBe('95000');

    const zeroRated = new BankingService(prisma, ledger, configWithCommissionBps(0));
    const quote = zeroRated.quoteOrder(money('100000'));
    expect(dong(quote.commission)).toBe('0');
    expect(dong(quote.sellerAmount)).toBe('100000');
  });

  // ---------------------------------------------------------------------------
  // Deposits (PSP webhook path)
  // ---------------------------------------------------------------------------

  it('rejects a non-whole-đồng or non-positive deposit before touching the database', async () => {
    await expect(fund('0')).rejects.toBeInstanceOf(RangeError);
    await expect(fund('100.50')).rejects.toBeInstanceOf(RangeError);
    expect(await prisma.ledgerTransfer.count()).toBe(0);
  });

  it('credits a deposit exactly once when the PSP webhook is delivered three times', async () => {
    const gatewayRef = `psp-${randomUUID()}`;
    const deliver = () =>
      banking.confirmDeposit({ userId: buyerId, amount: money('100000'), gatewayRef });

    const first = await deliver();
    const second = await deliver();
    const third = await deliver();

    expect(first.applied).toBe(true);
    expect(second).toEqual({ applied: false, transferId: first.transferId });
    expect(third).toEqual({ applied: false, transferId: first.transferId });

    expect(dong(await userBalance(prisma, buyerId))).toBe('100000');
    expect(await prisma.ledgerEntry.count()).toBe(2); // exactly one two-legged transfer
    expect(dong(await systemBalance(prisma, 'GATEWAY_CLEARING'))).toBe('-100000');
  });

  it('credits a deposit exactly once when three webhook deliveries race', async () => {
    const gatewayRef = `psp-${randomUUID()}`;
    const results = await Promise.allSettled([
      banking.confirmDeposit({ userId: buyerId, amount: money('100000'), gatewayRef }),
      banking.confirmDeposit({ userId: buyerId, amount: money('100000'), gatewayRef }),
      banking.confirmDeposit({ userId: buyerId, amount: money('100000'), gatewayRef }),
    ]);

    const fulfilled = results.filter(
      (r): r is PromiseFulfilledResult<{ applied: boolean; transferId: string }> =>
        r.status === 'fulfilled',
    );
    expect(fulfilled).toHaveLength(3);
    expect(fulfilled.filter((r) => r.value.applied)).toHaveLength(1);
    expect(new Set(fulfilled.map((r) => r.value.transferId)).size).toBe(1);

    expect(dong(await userBalance(prisma, buyerId))).toBe('100000');
    expect(await prisma.ledgerEntry.count()).toBe(2);
  });

  // ---------------------------------------------------------------------------
  // Order payment / release / refund
  // ---------------------------------------------------------------------------

  it('pays an order exactly once under a five-way concurrent double-click', async () => {
    await fund('100000');
    const order = await seedOrder(prisma, { buyerId, sellerId, gross: '100000' });

    const attempts = await Promise.allSettled(
      Array.from({ length: 5 }, () => banking.payForOrder({ orderId: order.id, buyerId })),
    );

    const fulfilled = attempts.filter(
      (r): r is PromiseFulfilledResult<{ applied: boolean; transferId: string }> =>
        r.status === 'fulfilled',
    );
    expect(fulfilled).toHaveLength(5);
    expect(fulfilled.filter((r) => r.value.applied)).toHaveLength(1);
    expect(new Set(fulfilled.map((r) => r.value.transferId)).size).toBe(1);

    expect(await prisma.ledgerTransfer.count({ where: { orderId: order.id } })).toBe(1);
    expect(dong(await userBalance(prisma, buyerId))).toBe('0');
    expect(dong(await systemBalance(prisma, 'ESCROW'))).toBe('100000');
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('PAID');
  });

  it('lets exactly one of two concurrent orders through when the buyer can only afford one', async () => {
    await fund('100000');
    const orderA = await seedOrder(prisma, { buyerId, sellerId, gross: '100000' });
    const orderB = await seedOrder(prisma, { buyerId, sellerId, gross: '100000' });

    const results = await Promise.allSettled([
      banking.payForOrder({ orderId: orderA.id, buyerId }),
      banking.payForOrder({ orderId: orderB.id, buyerId }),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBeInstanceOf(InsufficientFundsError);

    // The loser's transaction must have rolled back completely.
    const orders = await prisma.order.findMany({ where: { id: { in: [orderA.id, orderB.id] } } });
    expect(orders.filter((o) => o.status === 'PAID')).toHaveLength(1);
    expect(orders.filter((o) => o.status === 'PENDING_PAYMENT')).toHaveLength(1);

    expect(dong(await userBalance(prisma, buyerId))).toBe('0');
    expect(dong(await systemBalance(prisma, 'ESCROW'))).toBe('100000');

    const [{ min_balance }] = await prisma.$queryRaw<Array<{ min_balance: Prisma.Decimal }>>`
      select min(balance) as min_balance from "Wallet" where kind = 'USER'::"WalletKind"
    `;
    expect(min_balance.greaterThanOrEqualTo(0)).toBe(true);
  });

  it('replays a completed payment instead of charging again', async () => {
    await fund('100000');
    const order = await seedOrder(prisma, { buyerId, sellerId, gross: '100000' });

    const first = await banking.payForOrder({ orderId: order.id, buyerId });
    expect(first.applied).toBe(true);

    const replay = await banking.payForOrder({ orderId: order.id, buyerId });
    expect(replay).toEqual({ applied: false, transferId: first.transferId });

    expect(dong(await userBalance(prisma, buyerId))).toBe('0');
    expect(dong(await systemBalance(prisma, 'ESCROW'))).toBe('100000');
    expect(await prisma.ledgerTransfer.count({ where: { orderId: order.id } })).toBe(1);
  });

  it('refuses to pay an order that belongs to another user', async () => {
    await fund('100000');
    const order = await seedOrder(prisma, { buyerId, sellerId, gross: '100000' });

    await expect(banking.payForOrder({ orderId: order.id, buyerId: sellerId })).rejects.toBeInstanceOf(
      InvalidStateTransitionError,
    );
    expect(await prisma.ledgerTransfer.count({ where: { orderId: order.id } })).toBe(0);
    expect(dong(await userBalance(prisma, buyerId))).toBe('100000');
  });

  it('releases escrow with the frozen split, then refuses any later refund', async () => {
    await fund('100000');
    const order = await seedOrder(prisma, { buyerId, sellerId, gross: '100000' });
    await banking.payForOrder({ orderId: order.id, buyerId });
    await setOrderStatus(order.id, 'DELIVERED');

    const release = await banking.releaseOrder({ orderId: order.id, actorId: sellerId });
    expect(release.applied).toBe(true);

    expect(dong(await userBalance(prisma, sellerId))).toBe('95000');
    expect(dong(await systemBalance(prisma, 'PLATFORM_REVENUE'))).toBe('5000');
    expect(dong(await systemBalance(prisma, 'ESCROW'))).toBe('0');

    const orderAfter = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(orderAfter.status).toBe('COMPLETED');
    expect(orderAfter.releasedAt).not.toBeNull();

    const replay = await banking.releaseOrder({ orderId: order.id, actorId: sellerId });
    expect(replay).toEqual({ applied: false, transferId: release.transferId });

    // Money has left escrow for good: a refund attempt must change nothing.
    await expect(
      banking.refundOrder({ orderId: order.id, actorId: sellerId, reason: 'changed my mind' }),
    ).rejects.toBeInstanceOf(InvalidStateTransitionError);

    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('COMPLETED');
    expect(dong(await userBalance(prisma, buyerId))).toBe('0');
  });

  it('refunds an order whose money is still in escrow, and replays the refund safely', async () => {
    await fund('100000');
    const order = await seedOrder(prisma, { buyerId, sellerId, gross: '100000' });
    await banking.payForOrder({ orderId: order.id, buyerId });
    await setOrderStatus(order.id, 'SHIPPED');

    const refund = await banking.refundOrder({ orderId: order.id, actorId: buyerId, reason: 'not as described' });
    expect(refund.applied).toBe(true);

    expect(dong(await userBalance(prisma, buyerId))).toBe('100000');
    expect(dong(await systemBalance(prisma, 'ESCROW'))).toBe('0');
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('REFUNDED');

    const replay = await banking.refundOrder({ orderId: order.id, actorId: buyerId, reason: 'not as described' });
    expect(replay).toEqual({ applied: false, transferId: refund.transferId });
    expect(dong(await userBalance(prisma, buyerId))).toBe('100000');
  });

  it('will not pay a refund out of escrow that this order never funded', async () => {
    await fund('100000');
    const paidOrder = await seedOrder(prisma, { buyerId, sellerId, gross: '100000' });
    await banking.payForOrder({ orderId: paidOrder.id, buyerId });

    // A second order whose status was moved to PAID without any money arriving
    // (operator error, or a future bug). The ledger must not honour it.
    const ghostOrder = await seedOrder(prisma, { buyerId, sellerId, gross: '100000' });
    await setOrderStatus(ghostOrder.id, 'PAID');

    await expect(
      banking.refundOrder({ orderId: ghostOrder.id, actorId: buyerId, reason: 'never delivered' }),
    ).rejects.toBeInstanceOf(EscrowEmptyError);

    expect((await prisma.order.findUniqueOrThrow({ where: { id: ghostOrder.id } })).status).toBe('PAID');
    expect(dong(await systemBalance(prisma, 'ESCROW'))).toBe('100000'); // untouched
    expect(dong(await userBalance(prisma, buyerId))).toBe('0');
  });

  // ---------------------------------------------------------------------------
  // Withdrawals
  // ---------------------------------------------------------------------------

  it('debits the user the moment a withdrawal is approved, then settles it out', async () => {
    await fund('100000');
    const request = await seedPaidWithdrawal(prisma, { userId: buyerId, amount: '60000' });

    const approval = await banking.approveWithdrawal({ requestId: request.id, staffId: sellerId });
    expect(approval.applied).toBe(true);
    expect(dong(await userBalance(prisma, buyerId))).toBe('40000');
    expect(dong(await systemBalance(prisma, 'WITHDRAWAL_CLEARING'))).toBe('60000');

    await banking.settleWithdrawal({ requestId: request.id, bankRef: 'VCB-REF-1', actorId: sellerId });
    expect(dong(await systemBalance(prisma, 'WITHDRAWAL_CLEARING'))).toBe('0');
    expect(dong(await systemBalance(prisma, 'GATEWAY_CLEARING'))).toBe('-40000');
    expect((await prisma.withdrawalRequest.findUniqueOrThrow({ where: { id: request.id } })).status).toBe('SETTLED');
  });

  it('rejects a withdrawal the wallet cannot cover and leaves it REQUESTED', async () => {
    await fund('100000');
    const request = await seedPaidWithdrawal(prisma, { userId: buyerId, amount: '120000' });

    await expect(
      banking.approveWithdrawal({ requestId: request.id, staffId: sellerId }),
    ).rejects.toBeInstanceOf(InsufficientFundsError);

    expect((await prisma.withdrawalRequest.findUniqueOrThrow({ where: { id: request.id } })).status).toBe('REQUESTED');
    expect(dong(await userBalance(prisma, buyerId))).toBe('100000');
    expect(dong(await systemBalance(prisma, 'WITHDRAWAL_CLEARING'))).toBe('0');
    expect(await prisma.ledgerTransfer.count()).toBe(1); // the seed deposit only
  });

  it('gives the money back with a reversing transfer when the bank rejects the payout', async () => {
    await fund('100000');
    const request = await seedPaidWithdrawal(prisma, { userId: buyerId, amount: '30000' });

    const approval = await banking.approveWithdrawal({ requestId: request.id, staffId: sellerId });
    expect(dong(await userBalance(prisma, buyerId))).toBe('70000');

    const reversalId = await banking.failWithdrawal({
      requestId: request.id,
      reason: 'bank rejected the account number',
      actorId: sellerId,
    });

    expect(dong(await userBalance(prisma, buyerId))).toBe('100000');
    expect(dong(await systemBalance(prisma, 'WITHDRAWAL_CLEARING'))).toBe('0');
    expect((await prisma.withdrawalRequest.findUniqueOrThrow({ where: { id: request.id } })).status).toBe('FAILED');

    const approvalTransfer = await prisma.ledgerTransfer.findUniqueOrThrow({
      where: { id: approval.transferId },
    });
    const reversal = await prisma.ledgerTransfer.findUniqueOrThrow({ where: { id: reversalId } });
    expect(approvalTransfer.status).toBe('REVERSED');
    expect(reversal.reversalOfId).toBe(approval.transferId);
  });

  // ---------------------------------------------------------------------------
  // Statement
  // ---------------------------------------------------------------------------

  it('pages the statement by keyset without gaps or repeats', async () => {
    await fund('10000');
    await fund('20000');
    await fund('30000');

    const firstPage = await banking.getStatement({ userId: buyerId, take: 2 });
    expect(firstPage).toHaveLength(2);
    const secondPage = await banking.getStatement({
      userId: buyerId,
      take: 2,
      cursorId: firstPage[1].id,
    });
    expect(secondPage).toHaveLength(1);
    const ids = [...firstPage, ...secondPage].map((e) => e.id);
    expect(new Set(ids).size).toBe(3);
  });

  // ---------------------------------------------------------------------------
  // Whole-system reconciliation
  // ---------------------------------------------------------------------------

  it('leaves zero drift after running the full mix of flows', async () => {
    await fund('150000');

    const orderOne = await seedOrder(prisma, { buyerId, sellerId, gross: '100000' });
    await banking.payForOrder({ orderId: orderOne.id, buyerId });
    await setOrderStatus(orderOne.id, 'DELIVERED');
    await banking.releaseOrder({ orderId: orderOne.id, actorId: sellerId });

    const orderTwo = await seedOrder(prisma, { buyerId, sellerId, gross: '50000' });
    await banking.payForOrder({ orderId: orderTwo.id, buyerId });
    await setOrderStatus(orderTwo.id, 'SHIPPED');
    await banking.refundOrder({ orderId: orderTwo.id, actorId: buyerId, reason: 'damaged in transit' });

    const withdrawal = await seedPaidWithdrawal(prisma, { userId: sellerId, amount: '20000' });
    await banking.approveWithdrawal({ requestId: withdrawal.id, staffId: sellerId });
    await banking.settleWithdrawal({ requestId: withdrawal.id, bankRef: 'VCB-REF-2', actorId: sellerId });

    expect(dong(await userBalance(prisma, buyerId))).toBe('50000');
    expect(dong(await userBalance(prisma, sellerId))).toBe('75000');
    expect(dong(await systemBalance(prisma, 'PLATFORM_REVENUE'))).toBe('5000');
    expect(dong(await systemBalance(prisma, 'ESCROW'))).toBe('0');
    expect(dong(await systemBalance(prisma, 'WITHDRAWAL_CLEARING'))).toBe('0');
    // Gateway mirrors every đồng that crossed the system boundary: 150,000 funded in, 20,000 paid out.\n    expect(dong(await systemBalance(prisma, 'GATEWAY_CLEARING'))).toBe('-130000');

    // The cached Wallet.balance column must equal the ledger for every wallet.
    expect(await banking.findBalanceDrift()).toEqual([]);

    // And the ledger as a whole must net to zero.
    const [{ total }] = await prisma.$queryRaw<Array<{ total: Prisma.Decimal }>>`
      select coalesce(sum(amount), 0) as total from "LedgerEntry"
    `;
    expect(total.isZero()).toBe(true);
  });
});
