import { randomUUID } from 'node:crypto';
import request from 'supertest';

import { money } from '../../src/common/money';
import { resetDatabase, resetMoneyState, seedUser } from '../helpers/test-db';
import { createTestApp, TestApp } from '../helpers/test-app';
import { signTestToken } from '../helpers/test-token';

describe('HTTP: wallet', () => {
  let ctx: TestApp;
  let userId: string;
  let token: string;

  const fund = (amount: string) =>
    ctx.banking.confirmDeposit({
      userId,
      amount: money(amount),
      gatewayRef: randomUUID(),
    });

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
    userId = await seedUser(ctx.prisma, 'wallet-owner@example.com');
    token = signTestToken({ sub: userId });
  });

  beforeEach(async () => {
    await resetMoneyState(ctx.prisma);
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  it('GET /wallet returns a zero balance for a fresh account', async () => {
    const res = await request(ctx.app.getHttpServer())
      .get('/api/v1/wallet')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body).toEqual({
      balance: '0',
      currency: 'VND',
      updatedAt: expect.any(String),
    });
  });

  it('GET /wallet/statement is empty for a fresh account', async () => {
    const res = await request(ctx.app.getHttpServer())
      .get('/api/v1/wallet/statement')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body).toEqual({ data: [], nextCursor: null });
  });

  it('lists entries with signed amounts and the running balance', async () => {
    await fund('100000');
    await fund('50000');

    const res = await request(ctx.app.getHttpServer())
      .get('/api/v1/wallet/statement')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.nextCursor).toBeNull();
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0]).toMatchObject({
      kind: 'DEPOSIT',
      description: 'Wallet top-up',
      orderId: null,
      balanceAfter: '150000',
      amount: '50000',
    });
    expect(res.body.data[1]).toMatchObject({ amount: '100000', balanceAfter: '100000' });
    // Money crosses the wire as strings; JSON.parse must not turn it into a double.
    expect(typeof res.body.data[0].amount).toBe('string');
  });

  it('pages the statement by keyset cursor without gaps or repeats', async () => {
    await fund('10000');
    await fund('20000');
    await fund('30000');

    const first = await request(ctx.app.getHttpServer())
      .get('/api/v1/wallet/statement?take=2')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(first.body.data).toHaveLength(2);
    expect(first.body.nextCursor).not.toBeNull();

    const second = await request(ctx.app.getHttpServer())
      .get(`/api/v1/wallet/statement?take=2&cursor=${first.body.nextCursor}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(second.body.data).toHaveLength(1);
    expect(second.body.nextCursor).toBeNull();

    const ids = [...first.body.data, ...second.body.data].map((item: { id: string }) => item.id);
    expect(new Set(ids).size).toBe(3);
    const amounts = [...first.body.data, ...second.body.data].map((item: { amount: string }) => item.amount);
    expect(new Set(amounts)).toEqual(new Set(['10000', '20000', '30000']));
  });

  it.each([
    ['take=101 exceeds the cap', 'take=101'],
    ['take=0 is below the minimum', 'take=0'],
    ['take=abc is not a number', 'take=abc'],
    ['cursor is not a uuid', 'cursor=not-a-uuid'],
    ['an unknown query parameter is rejected', 'take=20&order=asc'],
  ])('rejects %s with VALIDATION_ERROR', async (_label, query) => {
    const res = await request(ctx.app.getHttpServer())
      .get(`/api/v1/wallet/statement?${query}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(400);

    expect(res.body).toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
    expect(Array.isArray(res.body.errors)).toBe(true);
  });
});
