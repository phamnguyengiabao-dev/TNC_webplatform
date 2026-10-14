import { randomUUID } from 'node:crypto';
import request from 'supertest';

import { CatalogAvailabilityService } from '../../src/modules/catalog/catalog-availability.service';
import { resetDatabase, resetShopeeState, seedShopeeItem, seedUser } from '../helpers/test-db';
import { createTestApp, TestApp } from '../helpers/test-app';
import { signTestToken } from '../helpers/test-token';

const BASE = '/api/v1';
const PRODUCTS = `${BASE}/admin/products`;
const STAGING = `${BASE}/admin/shopee/items`;
const DAY = 86_400_000;

describe('HTTP: curation API (STAFF/ADMIN)', () => {
  let ctx: TestApp;
  let staffToken: string;
  let userToken: string;

  function post(url: string, token: string, key: string | null = randomUUID()) {
    let call = request(ctx.app.getHttpServer()).post(url).set('Authorization', `Bearer ${token}`);
    if (key !== null) call = call.set('Idempotency-Key', key);
    return call;
  }

  async function createProduct(
    body: Record<string, unknown>,
    token = staffToken,
    key: string | null = randomUUID(),
  ): Promise<{ id: string; slug: string; visibility: string }> {
    const res = await post(PRODUCTS, token, key).send(body).expect(201);
    return res.body;
  }

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);

    const staffId = await seedUser(ctx.prisma, 'curation-staff@example.com');
    const userId = await seedUser(ctx.prisma, 'curation-user@example.com');
    await ctx.prisma.userProfile.update({ where: { id: staffId }, data: { role: 'STAFF' } });

    staffToken = signTestToken({ sub: staffId });
    userToken = signTestToken({ sub: userId });
  });

  beforeEach(async () => {
    await resetShopeeState(ctx.prisma);
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  describe('authorization', () => {
    it('rejects anonymous and non-staff callers', async () => {
      await request(ctx.app.getHttpServer()).get(STAGING).expect(401);
      await request(ctx.app.getHttpServer()).get(STAGING).set('Authorization', `Bearer ${userToken}`).expect(403);

      const res = await post(PRODUCTS, userToken)
        .send({ collectionSlug: 'pristine-retail' })
        .expect(403);
      expect(res.body.code).toBe('FORBIDDEN');
    });
  });

  describe('GET /admin/shopee/items', () => {
    it('lists staged items with their showroom link state', async () => {
      const linked = await seedShopeeItem(ctx.prisma, { itemId: '900', name: 'Son MAC', price: '450000' });
      await seedShopeeItem(ctx.prisma, { itemId: '901', name: 'Serum ABC', price: '250000', status: 'UNLIST' });

      await createProduct({
        shopeeItemId: linked.itemRefId,
        collectionSlug: 'curated-preloved',
        displayTitle: 'Son MAC Chili',
      });

      const res = await request(ctx.app.getHttpServer())
        .get(STAGING)
        .set('Authorization', `Bearer ${staffToken}`)
        .expect(200);

      expect(res.body.items).toHaveLength(2);
      const mac = res.body.items.find((item: { itemName: string }) => item.itemName === 'Son MAC');
      expect(mac).toMatchObject({
        itemId: '900',
        price: '450000',
        itemStatus: 'NORMAL',
        product: { title: 'Son MAC Chili', visibility: 'DRAFT', collection: 'curated-preloved' },
      });
      const serum = res.body.items.find((item: { itemName: string }) => item.itemName === 'Serum ABC');
      expect(serum.product).toBeNull();
      expect(serum.itemStatus).toBe('UNLIST');
    });

    it('filters by status, free text and link state', async () => {
      const linked = await seedShopeeItem(ctx.prisma, { itemId: '910', name: 'Kem nền Dior' });
      await seedShopeeItem(ctx.prisma, { itemId: '911', name: 'Phấn mắt MAC', status: 'BANNED' });
      await createProduct({ shopeeItemId: linked.itemRefId, collectionSlug: 'pristine-retail' });

      const server = ctx.app.getHttpServer();
      const auth = { Authorization: `Bearer ${staffToken}` };

      const banned = await request(server).get(`${STAGING}?status=BANNED`).set(auth).expect(200);
      expect(banned.body.items.map((i: { itemId: string }) => i.itemId)).toEqual(['911']);

      const unlinked = await request(server).get(`${STAGING}?linked=false`).set(auth).expect(200);
      expect(unlinked.body.items.map((i: { itemId: string }) => i.itemId)).toEqual(['911']);

      const linkedOnly = await request(server).get(`${STAGING}?linked=true`).set(auth).expect(200);
      expect(linkedOnly.body.items.map((i: { itemId: string }) => i.itemId)).toEqual(['910']);

      const search = await request(server).get(`${STAGING}?q=dior`).set(auth).expect(200);
      expect(search.body.items).toHaveLength(1);
    });
  });

  describe('POST /admin/products', () => {
    it('requires an Idempotency-Key and creates a DRAFT with a generated slug', async () => {
      const { itemRefId } = await seedShopeeItem(ctx.prisma, {
        itemId: '920',
        name: 'Sữa rửa mặt Đông Y',
      });

      const missingKey = await post(PRODUCTS, staffToken, null)
        .send({ shopeeItemId: itemRefId, collectionSlug: 'pristine-retail' })
        .expect(400);
      expect(missingKey.body.code).toBe('IDEMPOTENCY_KEY_REQUIRED');

      const created = await createProduct({
        shopeeItemId: itemRefId,
        collectionSlug: 'pristine-retail',
        displayTitle: 'Sữa rửa mặt Đông Y 150ml',
        blurb: 'Hàng mới nguyên seal',
        badges: ['New In Box'],
        sealStatus: 'sealed',
        qaNotes: { origin: 'Nhập khẩu chính hãng' },
      });

      expect(created.visibility).toBe('DRAFT');
      expect(created.slug).toBe('sua-rua-mat-dong-y-150ml');

      const stored = await ctx.prisma.product.findUniqueOrThrow({ where: { id: created.id } });
      expect(stored.publishedAt).toBeNull();
      expect(stored.badges).toEqual(['New In Box']);
      expect(stored.qaNotes).toEqual({ origin: 'Nhập khẩu chính hãng' });
    });

    it('replays the stored response for a repeated key instead of creating twice', async () => {
      const { itemRefId } = await seedShopeeItem(ctx.prisma, { itemId: '921', name: 'Item lặp' });
      const key = randomUUID();
      const body = { shopeeItemId: itemRefId, collectionSlug: 'pristine-retail' };

      const first = await post(PRODUCTS, staffToken, key).send(body).expect(201);
      const second = await post(PRODUCTS, staffToken, key).send(body).expect(201);

      expect(second.body.id).toBe(first.body.id);
      expect(second.headers['idempotent-replayed']).toBe('true');
      expect(await ctx.prisma.product.count()).toBe(1);
    });

    it('rejects an item that already has a showroom product', async () => {
      const { itemRefId } = await seedShopeeItem(ctx.prisma, { itemId: '922', name: 'Item trùng' });
      await createProduct({ shopeeItemId: itemRefId, collectionSlug: 'pristine-retail' });

      const res = await post(PRODUCTS, staffToken)
        .send({ shopeeItemId: itemRefId, collectionSlug: 'pristine-retail' })
        .expect(409);
      expect(res.body.code).toBe('ITEM_ALREADY_LINKED');
    });

    it('rejects an explicit slug that is already used', async () => {
      const first = await seedShopeeItem(ctx.prisma, { itemId: '923', name: 'A' });
      const second = await seedShopeeItem(ctx.prisma, { itemId: '924', name: 'B' });
      await createProduct({ shopeeItemId: first.itemRefId, collectionSlug: 'pristine-retail', slug: 'doc-quyen' });

      const res = await post(PRODUCTS, staffToken)
        .send({ shopeeItemId: second.itemRefId, collectionSlug: 'pristine-retail', slug: 'doc-quyen' })
        .expect(409);
      expect(res.body.code).toBe('SLUG_TAKEN');
    });

    it('404s an unknown item or collection and 400s an out-of-range condition', async () => {
      const server = ctx.app.getHttpServer();
      const auth = { Authorization: `Bearer ${staffToken}` };

      await request(server)
        .post(PRODUCTS)
        .set(auth)
        .set('Idempotency-Key', randomUUID())
        .send({ shopeeItemId: '2f1c1f7e-0000-4000-8000-000000000000', collectionSlug: 'pristine-retail' })
        .expect(404);

      await request(server)
        .post(PRODUCTS)
        .set(auth)
        .set('Idempotency-Key', randomUUID())
        .send({ collectionSlug: 'khong-co' })
        .expect(404);

      await request(server)
        .post(PRODUCTS)
        .set(auth)
        .set('Idempotency-Key', randomUUID())
        .send({ collectionSlug: 'pristine-retail', conditionPercent: 0 })
        .expect(400);
    });
  });

  describe('PATCH /admin/products/{id}', () => {
    it('updates curation fields and logs the change', async () => {
      const { itemRefId } = await seedShopeeItem(ctx.prisma, { itemId: '930', name: 'Son MAC' });
      const created = await createProduct({ shopeeItemId: itemRefId, collectionSlug: 'pristine-retail' });

      const res = await request(ctx.app.getHttpServer())
        .patch(`${PRODUCTS}/${created.id}`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({
          displayTitle: 'Son MAC Chili 95%',
          collectionSlug: 'curated-preloved',
          conditionPercent: 95,
          sealStatus: 'opened',
          badges: ['95% Left', 'Box Damaged'],
          blurb: 'Hộp móp nhẹ, ruột còn 95%.',
        })
        .expect(200);

      expect(res.body).toMatchObject({
        title: 'Son MAC Chili 95%',
        collection: 'curated-preloved',
        conditionPercent: 95,
        sealStatus: 'opened',
        badges: ['95% Left', 'Box Damaged'],
      });

      const audits = await ctx.prisma.auditLog.findMany({
        where: { entityType: 'Product', entityId: created.id },
      });
      expect(audits.map((row) => row.action).sort()).toEqual(['CREATE', 'UPDATE']);
    });

    it('rejects an empty patch, an unknown product and a taken slug', async () => {
      const { itemRefId } = await seedShopeeItem(ctx.prisma, { itemId: '931', name: 'Item' });
      const created = await createProduct({ shopeeItemId: itemRefId, collectionSlug: 'pristine-retail' });
      const server = ctx.app.getHttpServer();
      const auth = { Authorization: `Bearer ${staffToken}` };

      await request(server).patch(`${PRODUCTS}/${created.id}`).set(auth).send({}).expect(400);
      await request(server)
        .patch(`${PRODUCTS}/2f1c1f7e-0000-4000-8000-000000000000`)
        .set(auth)
        .send({ blurb: 'x' })
        .expect(404);

      const other = await seedShopeeItem(ctx.prisma, { itemId: '932', name: 'Item khác' });
      await createProduct({
        shopeeItemId: other.itemRefId,
        collectionSlug: 'pristine-retail',
        slug: 'da-co',
      });
      const conflict = await request(server)
        .patch(`${PRODUCTS}/${created.id}`)
        .set(auth)
        .send({ slug: 'da-co' })
        .expect(409);
      expect(conflict.body.code).toBe('SLUG_TAKEN');
    });
  });

  describe('publish / unpublish', () => {
    it('refuses to publish a product with no Shopee link at all', async () => {
      const created = await createProduct({ collectionSlug: 'pristine-retail', displayTitle: 'Chưa gắn gì' });

      const res = await post(`${PRODUCTS}/${created.id}/publish`, staffToken).expect(409);
      expect(res.body.code).toBe('ITEM_NOT_LINKED');
    });

    it('publishes a pre-loved piece that only has a buy link and shows it on the storefront', async () => {
      const created = await createProduct({
        collectionSlug: 'curated-preloved',
        displayTitle: 'Son YSL còn 90%',
        conditionPercent: 90,
        sealStatus: 'swatched',
        buyUrlOverride: 'https://shope.ee/preloved-ysl',
      });

      const published = await post(`${PRODUCTS}/${created.id}/publish`, staffToken).expect(200);
      expect(published.body.visibility).toBe('PUBLISHED');
      expect(published.body.publishedAt).not.toBeNull();

      const catalog = await request(ctx.app.getHttpServer()).get(`${BASE}/catalog/products`).expect(200);
      expect(catalog.body.items.map((i: { slug: string }) => i.slug)).toEqual([created.slug]);

      const detail = await request(ctx.app.getHttpServer())
        .get(`${BASE}/catalog/products/${created.slug}`)
        .expect(200);
      expect(detail.body.shopee).toBeNull();
      expect(detail.body.buyUrl).toBe('https://shope.ee/preloved-ysl');
    });

    it('refuses to publish when the Shopee item is banned', async () => {
      const { itemRefId } = await seedShopeeItem(ctx.prisma, { itemId: '940', name: 'Item bị khoá', status: 'BANNED' });
      const created = await createProduct({ shopeeItemId: itemRefId, collectionSlug: 'pristine-retail' });

      const res = await post(`${PRODUCTS}/${created.id}/publish`, staffToken).expect(410);
      expect(res.body.code).toBe('PRODUCT_UNLISTED');
    });

    it('is idempotent and reversible', async () => {
      const { itemRefId } = await seedShopeeItem(ctx.prisma, { itemId: '941', name: 'Item thường' });
      const created = await createProduct({ shopeeItemId: itemRefId, collectionSlug: 'pristine-retail' });

      await post(`${PRODUCTS}/${created.id}/publish`, staffToken).expect(200);
      const again = await post(`${PRODUCTS}/${created.id}/publish`, staffToken).expect(200);
      expect(again.body.visibility).toBe('PUBLISHED');

      const unpublished = await post(`${PRODUCTS}/${created.id}/unpublish`, staffToken).expect(200);
      expect(unpublished.body.visibility).toBe('DRAFT');

      await request(ctx.app.getHttpServer()).get(`${BASE}/catalog/products/${created.slug}`).expect(404);
      const catalog = await request(ctx.app.getHttpServer()).get(`${BASE}/catalog/products`).expect(200);
      expect(catalog.body.items).toHaveLength(0);
    });
  });

  describe('sync policy', () => {
    it('hides published products when their item disappears and restores them when it returns', async () => {
      const availability = ctx.app.get(CatalogAvailabilityService);
      const { itemRefId, shopId } = await seedShopeeItem(ctx.prisma, {
        itemId: '950',
        name: 'Item sắp bị khoá',
        price: '450000',
      });
      const created = await createProduct({ shopeeItemId: itemRefId, collectionSlug: 'pristine-retail' });
      await post(`${PRODUCTS}/${created.id}/publish`, staffToken).expect(200);

      await ctx.prisma.shopeeItem.update({ where: { id: itemRefId }, data: { itemStatus: 'BANNED' } });
      const hidden = await availability.applySyncPolicy(shopId);
      expect(hidden).toEqual({ hidden: 1, restored: 0 });

      const stored = await ctx.prisma.product.findUniqueOrThrow({ where: { id: created.id } });
      expect(stored.visibility).toBe('HIDDEN_BY_SYNC');

      const detail = await request(ctx.app.getHttpServer())
        .get(`${BASE}/catalog/products/${created.slug}`)
        .expect(410);
      expect(detail.body.code).toBe('PRODUCT_UNLISTED');

      const adminView = await request(ctx.app.getHttpServer())
        .get(`${PRODUCTS}?visibility=HIDDEN_BY_SYNC`)
        .set('Authorization', `Bearer ${staffToken}`)
        .expect(200);
      expect(adminView.body.items[0]).toMatchObject({ id: created.id, hiddenReason: 'BANNED' });

      await ctx.prisma.shopeeItem.update({ where: { id: itemRefId }, data: { itemStatus: 'NORMAL' } });
      const restored = await availability.applySyncPolicy(shopId);
      expect(restored).toEqual({ hidden: 0, restored: 1 });

      await request(ctx.app.getHttpServer()).get(`${BASE}/catalog/products/${created.slug}`).expect(200);
    });

    it('hides an item that has been missing from the source for too long', async () => {
      const availability = ctx.app.get(CatalogAvailabilityService);
      const { itemRefId, shopId } = await seedShopeeItem(ctx.prisma, {
        itemId: '951',
        name: 'Item mất tích',
        status: 'NOT_SEEN',
        lastSeenAt: new Date(Date.now() - 8 * DAY),
      });
      const created = await createProduct({ shopeeItemId: itemRefId, collectionSlug: 'pristine-retail' });
      await ctx.prisma.product.update({
        where: { id: created.id },
        data: { visibility: 'PUBLISHED', publishedAt: new Date() },
      });

      expect(await availability.applySyncPolicy(shopId)).toEqual({ hidden: 1, restored: 0 });
    });

    it('never touches a draft the staff parked on purpose', async () => {
      const availability = ctx.app.get(CatalogAvailabilityService);
      const { itemRefId, shopId } = await seedShopeeItem(ctx.prisma, {
        itemId: '952',
        name: 'Item nháp',
        status: 'DELETED',
      });
      const created = await createProduct({ shopeeItemId: itemRefId, collectionSlug: 'pristine-retail' });

      expect(await availability.applySyncPolicy(shopId)).toEqual({ hidden: 0, restored: 0 });
      const stored = await ctx.prisma.product.findUniqueOrThrow({ where: { id: created.id } });
      expect(stored.visibility).toBe('DRAFT');
    });
  });
});
