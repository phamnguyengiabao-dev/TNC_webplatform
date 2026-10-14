import { createHash } from 'node:crypto';
import { ConfigService } from '@nestjs/config';

import { AffiliateShopeeProvider } from './affiliate-shopee.provider';

function config(values: Record<string, string>): ConfigService {
  return { get: (key: string, fallback?: unknown) => values[key] ?? fallback } as unknown as ConfigService;
}

describe('AffiliateShopeeProvider', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('signs the exact JSON body and maps offer data without inventing stock', async () => {
    const provider = new AffiliateShopeeProvider(config({
      'shopee.shopId': '38003654',
      'shopee.affiliateAppId': 'app-123',
      'shopee.affiliateSecret': 'secret-value',
    }));
    const response = {
      data: {
        productOfferV2: {
          nodes: [{
            productId: 1589295236,
            productName: 'Son MAC Chili',
            price: '450000',
            imageUrl: 'https://cf.shopee.vn/file/a.jpg',
            offerLink: 'https://shope.ee/abc123',
            shopName: 'Thanh Nhan Cosmetic',
            soldCount: 12,
            ratingStar: 4.9,
            commissionRate: '0.05',
          }],
          pageInfo: { hasNextPage: true },
        },
      },
    };
    let requestInit: RequestInit | undefined;
    global.fetch = jest.fn(async (_input, init) => {
      requestInit = init;
      return new Response(JSON.stringify(response), { status: 200 });
    }) as typeof fetch;

    const result = await provider.fetchCatalog();
    const body = String(requestInit?.body);
    const timestamp = (requestInit?.headers as Record<string, string>).Authorization.match(/Timestamp=(\d+)/)?.[1];
    const signature = createHash('sha256')
      .update(`app-123${timestamp}${body}secret-value`)
      .digest('hex');

    expect((requestInit?.headers as Record<string, string>).Authorization).toBe(
      `SHA256 Credential=app-123, Timestamp=${timestamp}, Signature=${signature}`,
    );
    expect(result).toMatchObject({
      nextCursor: { value: '2' },
      items: [{
        shopeeItemId: '1589295236',
        name: 'Son MAC Chili',
        status: 'NORMAL',
        price: '450000',
        affiliateUrl: 'https://shope.ee/abc123',
        imageUrls: ['https://cf.shopee.vn/file/a.jpg'],
      }],
    });
    expect(result.items[0].stock).toBeUndefined();
  });

  it('creates a tracked short link for the canonical item URL', async () => {
    const provider = new AffiliateShopeeProvider(config({
      'shopee.shopId': '38003654',
      'shopee.affiliateAppId': 'app-123',
      'shopee.affiliateSecret': 'secret-value',
    }));
    global.fetch = jest.fn(async (_input, init) => {
      expect(String(init?.body)).toContain('https://shopee.vn/product/38003654/1589295236');
      return new Response(JSON.stringify({ data: { generateShortLink: { shortLink: 'https://shope.ee/tracked' } } }), { status: 200 });
    }) as typeof fetch;

    await expect(provider.buildBuyUrl({ shopeeShopId: '38003654', shopeeItemId: '1589295236' }))
      .resolves.toBe('https://shope.ee/tracked');
  });
});
