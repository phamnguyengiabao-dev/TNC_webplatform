import { Prisma } from '@prisma/client';
import request from 'supertest';

import {
  collectionIdBySlug,
  resetDatabase,
  resetShopeeState,
  seedShopeeItem,
} from '../helpers/test-db';
import { createTestApp, TestApp } from '../helpers/test-app';

const BASE = '/api/v1';
const DAY = 86_400_000;

type ItemStatus = 'NORMAL' | 'UNLIST' | 'BANNED' | 'DELETED' | 'NOT_SEEN';

describe('HTTP: catalog read API', () => {
  let ctx: TestApp;

  /** Dựng một sản phẩm showroom đã publish trên một item Shopee vừa sync. */
  async function seedProduct(options: {
    itemId: string;
    itemName?: string;
    price?: string;
    stock?: number | null;
    status?: ItemStatus;
    lastSeenAt?: Date;
    imageUrls?: string[];
    collection?: string;
    slug?: string;
    title?: string | null;
    blurb?: string;
    conditionPercent?: number;
    sealStatus?: string;
    badges?: string[];
    qaNotes?: Record<string, unknown>;
    buyUrlOverride?: string;
    featuredRank?: number;
    visibility?: 'DRAFT' | 'PUBLISHED' | 'HIDDEN_BY_SYNC';
    publishedAt?: Date | null;
  }): Promise<{ productId: string; slug: string }> {
    const { itemRefId } = await seedShopeeItem(ctx.prisma, {
      itemId: options.itemId,
      name: options.itemName ?? `Item ${options.itemId}`,
      price: options.price,
      stock: options.stock,
      status: options.status,
      imageUrls: options.imageUrls,
      lastSeenAt: options.lastSeenAt,
    });
    const collectionId = await collectionIdBySlug(ctx.prisma, options.collection ?? 'curated-preloved');
    const slug = options.slug ?? `sp-${options.itemId}`;

    const product = await ctx.prisma.product.create({
      data: {
        slug,
        shopeeItemId: itemRefId,
        collectionId,
        displayTitle: options.title ?? null,
        blurb: options.blurb ?? null,
        conditionPercent: options.conditionPercent ?? null,
        sealStatus: options.sealStatus ?? null,
        badges: options.badges ?? [],
        qaNotes: options.qaNotes as Prisma.InputJsonValue | undefined,
        buyUrlOverride: options.buyUrlOverride ?? null,
        featuredRank: options.featuredRank ?? null,
        visibility: options.visibility ?? 'PUBLISHED',
        publishedAt: options.publishedAt === undefined ? new Date() : options.publishedAt,
      },
      select: { id: true },
    });

    return { productId: product.id, slug };
  }

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
  });

  beforeEach(async () => {
    await resetShopeeState(ctx.prisma);
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  describe('GET /catalog/collections', () => {
    it('returns the two seeded collections without authentication', async () => {
      const res = await request(ctx.app.getHttpServer()).get(`${BASE}/catalog/collections`).expect(200);

      expect(res.body.items).toHaveLength(2);
      expect(res.body.items[0]).toMatchObject({ slug: 'pristine-retail', productCount: 0 });
      expect(res.body.items[1].slug).toBe('curated-preloved');
      expect(res.body.items[1].theme.conditionLabel).toBe('pre-loved');
    });

    it('counts only products the public can actually see', async () => {
      await seedProduct({ itemId: '1', collection: 'curated-preloved' });
      await seedProduct({ itemId: '2', collection: 'curated-preloved' });
      await seedProduct({ itemId: '3', collection: 'pristine-retail' });
      await seedProduct({ itemId: '4', collection: 'pristine-retail', visibility: 'DRAFT' });
      await seedProduct({ itemId: '5', collection: 'pristine-retail', status: 'BANNED' });

      const res = await request(ctx.app.getHttpServer()).get(`${BASE}/catalog/collections`).expect(200);
      const bySlug = Object.fromEntries(
        (res.body.items as Array<{ slug: string; productCount: number }>).map((c) => [c.slug, c.productCount]),
      );
      expect(bySlug['curated-preloved']).toBe(2);
      expect(bySlug['pristine-retail']).toBe(1);
    });
  });

  describe('GET /catalog/products', () => {
    it('lists published products with string prices and the pre-loved condition block', async () => {
      await seedProduct({
        itemId: '1589295236',
        itemName: 'Son MAC Chili',
        price: '450000',
        stock: 1,
        title: 'Son MAC Chili - 95%',
        conditionPercent: 95,
        sealStatus: 'opened',
        badges: ['95% Left', 'Box Damaged'],
        imageUrls: ['https://cf.shopee.vn/a.jpg', 'https://cf.shopee.vn/b.jpg'],
      });

      const res = await request(ctx.app.getHttpServer()).get(`${BASE}/catalog/products`).expect(200);

      expect(res.body.nextCursor).toBeNull();
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0]).toMatchObject({
        slug: 'sp-1589295236',
        title: 'Son MAC Chili - 95%',
        collection: 'curated-preloved',
        price: '450000',
        purchaseState: 'ON_SALE',
        condition: { percentLeft: 95, seal: 'opened', badges: ['95% Left', 'Box Damaged'] },
      });
      expect(typeof res.body.items[0].price).toBe('string');
      expect(res.body.items[0].images).toEqual([
        'https://cf.shopee.vn/a.jpg',
        'https://cf.shopee.vn/b.jpg',
      ]);
    });

    it('hides drafts, banned items and stale NOT_SEEN items', async () => {
      await seedProduct({ itemId: '10' });
      await seedProduct({ itemId: '11', visibility: 'DRAFT' });
      await seedProduct({ itemId: '12', status: 'DELETED' });
      await seedProduct({ itemId: '13', status: 'NOT_SEEN', lastSeenAt: new Date(Date.now() - 8 * DAY) });
      await seedProduct({ itemId: '14', status: 'NOT_SEEN', lastSeenAt: new Date(Date.now() - 2 * DAY) });
      await seedProduct({ itemId: '15', status: 'UNLIST' });

      const res = await request(ctx.app.getHttpServer()).get(`${BASE}/catalog/products`).expect(200);
      const slugs = (res.body.items as Array<{ slug: string }>).map((item) => item.slug).sort();

      expect(slugs).toEqual(['sp-10', 'sp-14', 'sp-15']);
      expect(res.body.items.find((item: { slug: string }) => item.slug === 'sp-15').purchaseState).toBe('PAUSED');
    });

    it('filters by collection, condition, price, stock and free text', async () => {
      await seedProduct({
        itemId: '20',
        itemName: 'Kem nền Dior',
        price: '1200000',
        stock: 4,
        collection: 'pristine-retail',
        conditionPercent: 100,
      });
      await seedProduct({
        itemId: '21',
        itemName: 'Phấn mắt MAC',
        price: '300000',
        stock: 0,
        conditionPercent: 60,
      });
      await seedProduct({
        itemId: '22',
        itemName: 'Serum ABC',
        price: '950000',
        stock: 2,
        conditionPercent: 90,
      });

      const server = ctx.app.getHttpServer();

      const retail = await request(server).get(`${BASE}/catalog/products?collection=pristine-retail`).expect(200);
      expect(retail.body.items.map((i: { slug: string }) => i.slug)).toEqual(['sp-20']);

      const cheap = await request(server).get(`${BASE}/catalog/products?price_max=950000`).expect(200);
      expect(cheap.body.items.map((i: { slug: string }) => i.slug).sort()).toEqual(['sp-21', 'sp-22']);

      const inStock = await request(server).get(`${BASE}/catalog/products?in_stock=true`).expect(200);
      expect(inStock.body.items.map((i: { slug: string }) => i.slug).sort()).toEqual(['sp-20', 'sp-22']);

      const outOfStock = await request(server).get(`${BASE}/catalog/products?in_stock=false`).expect(200);
      expect(outOfStock.body.items.map((i: { slug: string }) => i.slug)).toEqual(['sp-21']);

      const condition = await request(server).get(`${BASE}/catalog/products?condition_min=90`).expect(200);
      expect(condition.body.items.map((i: { slug: string }) => i.slug).sort()).toEqual(['sp-20', 'sp-22']);

      const search = await request(server).get(`${BASE}/catalog/products?q=dior`).expect(200);
      expect(search.body.items.map((i: { slug: string }) => i.slug)).toEqual(['sp-20']);
    });

    it('rejects a cursor that was minted for another sort', async () => {
      await seedProduct({ itemId: '30', price: '100000' });
      await seedProduct({ itemId: '31', price: '200000' });

      const first = await request(ctx.app.getHttpServer())
        .get(`${BASE}/catalog/products?sort=price_asc&take=1`)
        .expect(200);
      expect(first.body.items).toHaveLength(1);
      expect(first.body.nextCursor).not.toBeNull();

      const res = await request(ctx.app.getHttpServer())
        .get(`${BASE}/catalog/products?sort=price_desc&cursor=${encodeURIComponent(first.body.nextCursor)}`)
        .expect(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });

    it('walks every product exactly once with price_asc keyset pagination', async () => {
      const prices = ['500000', '300000', '300000', '1000000', '700000'];
      for (const [index, price] of prices.entries()) {
        await seedProduct({ itemId: String(40 + index), price, title: `P${index}` });
      }

      const seen: string[] = [];
      let cursor: string | null = null;
      for (let page = 0; page < 10; page += 1) {
        const search: string[] = ['sort=price_asc', 'take=2'];
        if (cursor !== null) search.push(`cursor=${encodeURIComponent(cursor)}`);
        const res: { body: { items: Array<{ slug: string }>; nextCursor: string | null } } = await request(
          ctx.app.getHttpServer(),
        )
          .get(`${BASE}/catalog/products?${search.join('&')}`)
          .expect(200);
        seen.push(...res.body.items.map((item) => item.slug));
        cursor = res.body.nextCursor;
        if (!cursor) break;
      }

      expect(seen).toHaveLength(5);
      expect(new Set(seen).size).toBe(5);
      // Hai món 300.000 đồng bằng giá nhau: thứ tự giữa chúng do tie-breaker
      // (id) quyết định nên chỉ khẳng định chúng nằm trong ba vị trí đầu.
      expect(seen.slice(0, 3).sort()).toEqual(['sp-40', 'sp-41', 'sp-42']);
      expect(seen.slice(3)).toEqual(['sp-44', 'sp-43']);
    });

    it('supports the featured ranking sort', async () => {
      await seedProduct({ itemId: '50', featuredRank: 3 });
      await seedProduct({ itemId: '51', featuredRank: 1 });
      await seedProduct({ itemId: '52' });

      const res = await request(ctx.app.getHttpServer())
        .get(`${BASE}/catalog/products?sort=featured`)
        .expect(200);
      expect(res.body.items.map((i: { slug: string }) => i.slug)).toEqual(['sp-51', 'sp-50', 'sp-52']);
    });

    it('rejects invalid query values', async () => {
      const server = ctx.app.getHttpServer();
      await request(server).get(`${BASE}/catalog/products?take=999`).expect(400);
      await request(server).get(`${BASE}/catalog/products?price_min=abc`).expect(400);
      await request(server).get(`${BASE}/catalog/products?sort=cheapest`).expect(400);
      await request(server).get(`${BASE}/catalog/products?in_stock=maybe`).expect(400);
      await request(server).get(`${BASE}/catalog/products?unknown=1`).expect(400);
    });
  });

  describe('GET /catalog/products/{slug}', () => {
    it('returns the full PDP payload with the Shopee block and buyPath', async () => {
      const { productId, slug } = await seedProduct({
        itemId: '1589295236',
        itemName: 'Son MAC Chili',
        price: '450000',
        stock: 1,
        title: 'Son MAC Chili - 95%',
        conditionPercent: 95,
        sealStatus: 'opened',
        badges: ['95% Left'],
        qaNotes: { sterilized: 'UV-C 2026-10-01', origin: 'Mua tại MAC Vincom', authenticity: 'verified' },
      });

      const res = await request(ctx.app.getHttpServer()).get(`${BASE}/catalog/products/${slug}`).expect(200);

      expect(res.body.id).toBe(productId);
      expect(res.body.qa).toEqual({
        sterilized: 'UV-C 2026-10-01',
        origin: 'Mua tại MAC Vincom',
        authenticity: 'verified',
      });
      expect(res.body.shopee).toMatchObject({
        itemId: '1589295236',
        shopId: '38003654',
        price: '450000',
        stock: 1,
        status: 'NORMAL',
        url: 'https://shopee.vn/product/38003654/1589295236?utm_source=tnc_showroom',
      });
      expect(res.body.buyPath).toBe(`${BASE}/catalog/products/${productId}/buy`);
      expect(res.body.buyUrl).toBe(
        'https://shopee.vn/product/38003654/1589295236?utm_source=tnc_showroom',
      );
    });

    it('prefers buyUrlOverride over the derived Shopee link', async () => {
      const { slug } = await seedProduct({
        itemId: '60',
        buyUrlOverride: 'https://shope.ee/abc123',
      });

      const res = await request(ctx.app.getHttpServer()).get(`${BASE}/catalog/products/${slug}`).expect(200);
      expect(res.body.buyUrl).toBe('https://shope.ee/abc123');
      expect(res.body.shopee.url).toContain('shopee.vn/product/');
    });

    it('404s an unknown slug and a draft product', async () => {
      await seedProduct({ itemId: '61', slug: 'nhap', visibility: 'DRAFT' });
      const server = ctx.app.getHttpServer();

      await request(server).get(`${BASE}/catalog/products/khong-ton-tai`).expect(404);
      const draft = await request(server).get(`${BASE}/catalog/products/nhap`).expect(404);
      expect(draft.body.code).toBe('NOT_FOUND');
    });

    it('410s a product whose Shopee item disappeared, even before the sync flips it', async () => {
      const { slug } = await seedProduct({ itemId: '62', status: 'BANNED' });

      const res = await request(ctx.app.getHttpServer()).get(`${BASE}/catalog/products/${slug}`).expect(410);
      expect(res.body.code).toBe('PRODUCT_UNLISTED');
      expect(res.body.type).toContain('product-unlisted');
    });
  });

  describe('buy deep-link', () => {
    it('302s to Shopee and records a hashed click', async () => {
      const { productId } = await seedProduct({ itemId: '70', price: '250000' });

      const res = await request(ctx.app.getHttpServer())
        .get(`${BASE}/catalog/products/${productId}/buy`)
        .set('User-Agent', 'jest-supertest')
        .set('Referer', 'https://tnc.vn/san-pham/sp-70')
        .redirects(0)
        .expect(302);

      expect(res.headers.location).toBe(
        'https://shopee.vn/product/38003654/70?utm_source=tnc_showroom',
      );

      const clicks = await ctx.prisma.outboundClick.findMany({ where: { productId } });
      expect(clicks).toHaveLength(1);
      expect(clicks[0].referrer).toBe('https://tnc.vn/san-pham/sp-70');
      expect(clicks[0].ipHash).toHaveLength(64);
      expect(clicks[0].uaHash).toHaveLength(64);
      expect(clicks[0].ipHash).not.toContain('127.0.0.1');
      expect(clicks[0].uaHash).not.toContain('jest-supertest');
    });

    it('returns the url to a SPA and still records the click', async () => {
      const { productId } = await seedProduct({ itemId: '71' });

      const res = await request(ctx.app.getHttpServer())
        .post(`${BASE}/catalog/products/${productId}/click`)
        .send({ referrer: 'https://tnc.vn/san-pham' })
        .expect(200);

      expect(res.body.url).toContain('https://shopee.vn/product/38003654/71');
      expect(await ctx.prisma.outboundClick.count({ where: { productId } })).toBe(1);
    });

    it('refuses to send a customer to a hidden product', async () => {
      const { productId } = await seedProduct({ itemId: '72', status: 'DELETED' });

      const res = await request(ctx.app.getHttpServer())
        .get(`${BASE}/catalog/products/${productId}/buy`)
        .redirects(0)
        .expect(410);
      expect(res.body.code).toBe('PRODUCT_UNLISTED');
      expect(await ctx.prisma.outboundClick.count({ where: { productId } })).toBe(0);
    });

    it('404s an unknown product id and 400s a malformed one', async () => {
      const server = ctx.app.getHttpServer();
      await request(server).get(`${BASE}/catalog/products/2f1c1f7e-0000-4000-8000-000000000000/buy`).expect(404);
      await request(server).get(`${BASE}/catalog/products/not-a-uuid/buy`).expect(400);
    });
  });
});
