import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import request from 'supertest';

import { money } from '../../src/common/money';
import {
  resetDatabase,
  resetMoneyState,
  seedOrder,
  seedUser,
  systemBalance,
  userBalance,
} from '../helpers/test-db';
import { createTestApp, TestApp } from '../helpers/test-app';
import { signTestToken } from '../helpers/test-token';

const BASE = '/api/v1';

describe('HTTP: POST /orders/{id}/pay-wallet', () => {
  let ctx: TestApp;
  let buyerId: string;
  let otherBuyerId: string;
  let sellerId: string;
  let buyerToken: string;
  let otherBuyerToken: string;

  async function fund(userId: string, amount: string): Promise<void> {
    await ctx.banking.confirmDeposit({ userId, amount: money(amount), gatewayRef: randomUUID() });
  }

  function pay(orderId: string, options: { token?: string; key?: string | null } = {}) {
    let call = request(ctx.app.getHttpServer())
      .post(`${BASE}/orders/${orderId}/pay-wallet`)
      .set('Authorization', `Bearer ${options.token ?? buyerToken}`);
    if (options.key !== null) {
      call = call.set('Idempotency-Key', options.key ?? randomUUID());
    }
    return call;
  }

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
    buyerId = await seedUser(ctx.prisma, 'pay-buyer@example.com');
    otherBuyerId = await seedUser(ctx.prisma, 'other-buyer@example.com');
    sellerId = await seedUser(ctx.prisma, 'pay-seller@example.com');
    buyerToken = signTestToken({ sub: buyerId });
    otherBuyerToken = signTestToken({ sub: otherBuyerId });
  });

  beforeEach(async () => {
    await resetMoneyState(ctx.prisma);
  });

  afterAll(async () => {
    // Whole-system reconciliation after the full mix of scenarios (docs 6.11).
    const integrity = await ctx.prisma.$queryRaw<
      Array<{ total_drift: Prisma.Decimal; entry_count: bigint }>
    >`SELECT total_drift, entry_count FROM "LedgerIntegrity"`;
    expect(integrity[0].total_drift.toString()).toBe('0');
    expect(await ctx.banking.findBalanceDrift()).toEqual([]);

    await ctx.app.close();
  });

  it('pays from the wallet and moves the money into escrow', async () => {
    await fund(buyerId, '300000');
    const order = await seedOrder(ctx.prisma, { buyerId, sellerId, gross: '200000' });

    const res = await pay(order.id).expect(200);

    expect(res.body).toMatchObject({ orderId: order.id, status: 'PAID', applied: true });
    expect(typeof res.body.transferId).toBe('string');
    expect(new Date(res.body.paidAt).toString()).not.toBe('Invalid Date');

    expect((await userBalance(ctx.prisma, buyerId)).toString()).toBe('100000');
    expect((await systemBalance(ctx.prisma, 'ESCROW')).toString()).toBe('200000');
    const stored = await ctx.prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(stored.status).toBe('PAID');
    expect(stored.paidAt).not.toBeNull();
  });

  it('replays the stored response for a repeated Idempotency-Key', async () => {
    await fund(buyerId, '300000');
    const order = await seedOrder(ctx.prisma, { buyerId, sellerId, gross: '200000' });
    const key = randomUUID();

    const first = await pay(order.id, { key }).expect(200);
    const replay = await pay(order.id, { key }).expect(200);

    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect(replay.body).toEqual(first.body);
    expect((await userBalance(ctx.prisma, buyerId)).toString()).toBe('100000');
    expect((await systemBalance(ctx.prisma, 'ESCROW')).toString()).toBe('200000');
  });

  it('rejects the same key reused for a different order with IDEMPOTENCY_CONFLICT', async () => {
    await fund(buyerId, '500000');
    const firstOrder = await seedOrder(ctx.prisma, { buyerId, sellerId, gross: '100000' });
    const secondOrder = await seedOrder(ctx.prisma, { buyerId, sellerId, gross: '100000' });
    const key = randomUUID();

    await pay(firstOrder.id, { key }).expect(200);
    const balanceAfterFirst = await userBalance(ctx.prisma, buyerId);

    const res = await pay(secondOrder.id, { key }).expect(409);
    expect(res.body).toMatchObject({ status: 409, code: 'IDEMPOTENCY_CONFLICT' });
    expect((await userBalance(ctx.prisma, buyerId)).toString()).toBe(balanceAfterFirst.toString());
  });

  it('requires the Idempotency-Key header', async () => {
    await fund(buyerId, '300000');
    const order = await seedOrder(ctx.prisma, { buyerId, sellerId, gross: '100000' });

    const res = await pay(order.id, { key: null }).expect(400);
    expect(res.body.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });

  it('rejects an over-long Idempotency-Key', async () => {
    const order = await seedOrder(ctx.prisma, { buyerId, sellerId, gross: '100000' });

    const res = await pay(order.id, { key: 'x'.repeat(129) }).expect(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('fails with INSUFFICIENT_FUNDS without touching any balance', async () => {
    await fund(buyerId, '100000');
    const order = await seedOrder(ctx.prisma, { buyerId, sellerId, gross: '200000' });
    const key = randomUUID();

    const res = await pay(order.id, { key }).expect(409);
    expect(res.body).toMatchObject({
      type: 'https://tnc.vn/errors/insufficient-funds',
      status: 409,
      code: 'INSUFFICIENT_FUNDS',
    });
    // The domain message names the wallet and the amount; it must stay in the log.
    expect(JSON.stringify(res.body)).not.toContain('cannot cover');
    expect(res.body.message).toBeUndefined();

    const stored = await ctx.prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(stored.status).toBe('PENDING_PAYMENT');
    expect((await userBalance(ctx.prisma, buyerId)).toString()).toBe('100000');
    expect((await systemBalance(ctx.prisma, 'ESCROW')).toString()).toBe('0');

    // A failed attempt releases the key, so the client may retry it after fixing
    // the cause (here: topping up).
    await fund(buyerId, '100000');
    const retry = await pay(order.id, { key }).expect(200);
    expect(retry.body.applied).toBe(true);
    expect((await userBalance(ctx.prisma, buyerId)).toString()).toBe('0');
  });

  it('forbids a user who is not the buyer', async () => {
    await fund(otherBuyerId, '300000');
    const order = await seedOrder(ctx.prisma, { buyerId, sellerId, gross: '100000' });

    const res = await pay(order.id, { token: otherBuyerToken }).expect(403);
    expect(res.body.code).toBe('FORBIDDEN');

    const stored = await ctx.prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(stored.status).toBe('PENDING_PAYMENT');
    expect((await systemBalance(ctx.prisma, 'ESCROW')).toString()).toBe('0');
  });

  it('returns 404 for an unknown order', async () => {
    const res = await pay(randomUUID()).expect(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });

  it('rejects a malformed order id with VALIDATION_ERROR', async () => {
    const res = await pay('not-a-uuid').expect(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('returns INVALID_STATE_TRANSITION when the order is no longer payable', async () => {
    await fund(buyerId, '300000');
    const order = await seedOrder(ctx.prisma, { buyerId, sellerId, gross: '100000' });
    await ctx.prisma.order.update({ where: { id: order.id }, data: { status: 'CANCELLED' } });

    const res = await pay(order.id).expect(409);
    expect(res.body.code).toBe('INVALID_STATE_TRANSITION');
    expect((await userBalance(ctx.prisma, buyerId)).toString()).toBe('300000');
  });

  it('replays the ledger transfer when the same order is paid with a new key', async () => {
    await fund(buyerId, '300000');
    const order = await seedOrder(ctx.prisma, { buyerId, sellerId, gross: '100000' });

    const first = await pay(order.id).expect(200);
    const second = await pay(order.id).expect(200);

    expect(first.body.applied).toBe(true);
    expect(second.body.applied).toBe(false);
    expect(second.body.transferId).toBe(first.body.transferId);
    expect((await userBalance(ctx.prisma, buyerId)).toString()).toBe('200000');
  });

  it('requires authentication', async () => {
    const order = await seedOrder(ctx.prisma, { buyerId, sellerId, gross: '100000' });
    await request(ctx.app.getHttpServer())
      .post(`${BASE}/orders/${order.id}/pay-wallet`)
      .set('Idempotency-Key', randomUUID())
      .expect(401);
  });
});
