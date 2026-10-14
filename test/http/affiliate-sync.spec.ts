import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { resetShopeeState, seedShopeeItem } from '../helpers/test-db';
import { createTestApp, TestApp } from '../helpers/test-app';
import { seedUser } from '../helpers/test-db';
import { signTestToken } from '../helpers/test-token';

describe('Shopee Affiliate sync', () => {
  let ctx: TestApp;
  let config: ConfigService;
  let token: string;
  const originalFetch = global.fetch;

  beforeAll(async () => {
    ctx = await createTestApp();
    config = ctx.app.get(ConfigService);
    config.set('shopee.provider', 'affiliate');
    config.set('shopee.shopId', '38003654');
    config.set('shopee.affiliateAppId', 'test-app');
    config.set('shopee.affiliateSecret', 'test-secret');
    await resetShopeeState(ctx.prisma);
    const staffId = await seedUser(ctx.prisma, 'affiliate-sync-staff@example.com');
    await ctx.prisma.userProfile.update({ where: { id: staffId }, data: { role: 'STAFF' } });
    token = signTestToken({ sub: staffId });
  });

  beforeEach(async () => {
    await resetShopeeState(ctx.prisma);
  });

  afterAll(async () => {
    global.fetch = originalFetch;
    await ctx.app.close();
  });

  it('refreshes price, image and affiliate link while preserving stock/status and never marking omissions missing', async () => {
    const { itemRefId, shopId } = await seedShopeeItem(ctx.prisma, {
      itemId: '77001',
      name: 'Old title',
      price: '100000',
      stock: 0,
      status: 'UNLIST',
      imageUrls: ['https://cf.shopee.vn/file/old.jpg'],
    });
    const omitted = await seedShopeeItem(ctx.prisma, { itemId: '77002', name: 'Not in offer feed', status: 'NORMAL' });
    global.fetch = jest.fn(async () => new Response(JSON.stringify({
      data: {
        productOfferV2: {
          nodes: [{
            productId: '77001',
            productName: 'New title',
            price: '125000',
            imageUrl: 'https://cf.shopee.vn/file/new.jpg',
            offerLink: 'https://shope.ee/tracked-77001',
          }],
          pageInfo: { hasNextPage: false },
        },
      },
    }), { status: 200 })) as typeof fetch;

    const response = await request(ctx.app.getHttpServer())
      .post('/api/v1/admin/sync/run')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', randomUUID())
      .send({ provider: 'affiliate', mode: 'full' })
      .expect(200);
    const result = response.body;
    const updated = await ctx.prisma.shopeeItem.findUniqueOrThrow({ where: { id: itemRefId } });
    const untouched = await ctx.prisma.shopeeItem.findUniqueOrThrow({ where: { id: omitted.itemRefId } });

    expect(result.status).toBe('SUCCEEDED');
    expect(updated).toMatchObject({
      itemName: 'New title',
      itemStatus: 'UNLIST',
      stock: 0,
      affiliateUrl: 'https://shope.ee/tracked-77001',
      imageUrls: ['https://cf.shopee.vn/file/new.jpg'],
    });
    expect(updated.price?.toString()).toBe('125000');
    expect(untouched.itemStatus).toBe('NORMAL');
    expect(untouched.lastSeenAt.getTime()).toBeLessThanOrEqual(Date.now());
    expect(result.stats.notSeen).toBe(0);
    expect(await ctx.prisma.syncRun.count({ where: { shopId, provider: 'AFFILIATE', status: 'SUCCEEDED' } })).toBe(1);

    const history = await request(ctx.app.getHttpServer())
      .get('/api/v1/admin/sync/runs?provider=AFFILIATE')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(history.body.items[0]).toMatchObject({ id: result.runId, provider: 'AFFILIATE', status: 'SUCCEEDED' });
    await request(ctx.app.getHttpServer())
      .get(`/api/v1/admin/sync/runs/${result.runId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
  });
});
