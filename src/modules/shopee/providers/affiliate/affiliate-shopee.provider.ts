import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';

import { AppError } from '../../../../common/errors/app-error';
import type {
  ItemSnapshot,
  ShopeeItemRef,
  ShopeeSyncProvider,
  SyncCatalogResult,
  SyncCursor,
} from '../shopee-sync-provider.interface';

const PAGE_SIZE = 50;
const DEFAULT_ENDPOINT = 'https://open-api.affiliate.shopee.vn/graphql';

/** Shopee Affiliate Open API provider. It refreshes offer fields only. */
@Injectable()
export class AffiliateShopeeProvider implements ShopeeSyncProvider {
  readonly name = 'affiliate' as const;

  constructor(private readonly config: ConfigService) {}

  async fetchCatalog(cursor?: SyncCursor): Promise<SyncCatalogResult> {
    const page = cursor ? Number.parseInt(cursor.value, 10) : 1;
    if (!Number.isSafeInteger(page) || page < 1) {
      throw AppError.validation('invalid affiliate page cursor', 'Con trỏ đồng bộ không hợp lệ.');
    }
    const shopId = this.config.get<string>('shopee.shopId', '').trim();
    if (!/^\d{1,19}$/.test(shopId)) return this.notConnected('SHOPEE_SHOP_ID is missing or invalid');

    const body = JSON.stringify({
      query: `query { productOfferV2(keyword: "", matchId: ${shopId}, listType: 1, page: ${page}, limit: ${PAGE_SIZE}) { nodes { productId productName price imageUrl offerLink shopName soldCount ratingStar commissionRate } pageInfo { page limit hasNextPage } } }`,
    });
    const data = await this.request(body);
    const root = asRecord(data.productOfferV2);
    const nodes = Array.isArray(root?.nodes) ? root.nodes : [];
    const items = nodes.flatMap((value) => {
      const node = asRecord(value);
      const itemId = stringValue(node?.productId);
      const name = stringValue(node?.productName);
      if (!itemId || !/^\d{1,19}$/.test(itemId) || !name) return [];
      const image = stringValue(node?.imageUrl);
      const price = decimalString(node?.price);
      const offerLink = safeShopeeUrl(node?.offerLink);
      const snapshot: ItemSnapshot = {
        shopeeItemId: itemId,
        name,
        // Affiliate feeds do not report inventory or authoritative listing
        // status. SyncService preserves those fields for existing items.
        status: 'NORMAL',
        ...(price ? { price, priceMin: price, priceMax: price } : {}),
        imageUrls: image ? [image] : [],
        ...(offerLink ? { affiliateUrl: offerLink } : {}),
      raw: {
          source: 'affiliate',
          shopName: stringValue(node?.shopName),
          soldCount: node?.soldCount ?? null,
          ratingStar: node?.ratingStar ?? null,
          commissionRate: node?.commissionRate ?? null,
          offerLink,
        },
      };
      return [snapshot];
    });

    const pageInfo = asRecord(root?.pageInfo);
    const hasNext = pageInfo?.hasNextPage === true;
    return { items, ...(hasNext ? { nextCursor: { value: String(page + 1) } } : {}) };
  }

  async buildBuyUrl(item: ShopeeItemRef): Promise<string> {
    const originUrl = `https://shopee.vn/product/${encodeURIComponent(item.shopeeShopId)}/${encodeURIComponent(item.shopeeItemId)}`;
    const body = JSON.stringify({
      query: `mutation { generateShortLink(input: { originUrl: "${originUrl}" }) { shortLink } }`,
    });
    const result = await this.request(body);
    const shortLink = stringValue(asRecord(result.generateShortLink)?.shortLink);
    return safeShopeeUrl(shortLink) ?? originUrl;
  }

  private async request(body: string): Promise<Record<string, unknown>> {
    const appId = this.config.get<string>('shopee.affiliateAppId', '').trim();
    const secret = this.config.get<string>('shopee.affiliateSecret', '');
    if (!appId || !secret) return this.notConnected('Shopee Affiliate credentials are missing');

    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = createHash('sha256')
      .update(`${appId}${timestamp}${body}${secret}`)
      .digest('hex');
    const authorization = `SHA256 Credential=${appId}, Timestamp=${timestamp}, Signature=${signature}`;
    const endpoint = this.config.get<string>('shopee.affiliateEndpoint', DEFAULT_ENDPOINT);

    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: { Authorization: authorization, 'Content-Type': 'application/json' },
        body,
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      throw new AppError('SERVICE_UNAVAILABLE', {
        logMessage: `Shopee Affiliate request failed: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
    if (!response.ok) {
      throw new AppError('SERVICE_UNAVAILABLE', {
        logMessage: `Shopee Affiliate returned HTTP ${response.status}`,
      });
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new AppError('SERVICE_UNAVAILABLE', { logMessage: 'Shopee Affiliate returned invalid JSON' });
    }
    const envelope = asRecord(payload);
    if (!envelope || !asRecord(envelope.data)) {
      throw new AppError('SERVICE_UNAVAILABLE', {
        logMessage: `Shopee Affiliate GraphQL error: ${safeErrorText(envelope?.errors)}`,
      });
    }
    return envelope.data as Record<string, unknown>;
  }

  private notConnected(reason: string): never {
    throw new AppError('SHOPEE_NOT_CONNECTED', { logMessage: reason });
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim() || null : null;
}

function decimalString(value: unknown): string | null {
  const text = stringValue(value);
  return text && /^\d+(?:\.\d+)?$/.test(text) ? text : null;
}

function safeShopeeUrl(value: unknown): string | null {
  const text = stringValue(value);
  if (!text) return null;
  try {
    const url = new URL(text);
    return url.protocol === 'https:' && (url.hostname === 'shopee.vn' || url.hostname.endsWith('.shopee.vn') || url.hostname === 'shope.ee')
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function safeErrorText(value: unknown): string {
  if (!Array.isArray(value)) return 'unknown error';
  return value
    .map((item) => stringValue(asRecord(item)?.message) ?? 'GraphQL error')
    .join('; ')
    .slice(0, 300);
}
