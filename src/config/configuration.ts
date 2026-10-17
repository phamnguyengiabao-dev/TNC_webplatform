/**
 * Maps environment variables onto the `app.*` and `auth.*` namespaces.
 *
 * Wire it in AppModule with:
 *   ConfigModule.forRoot({ isGlobal: true, load: [configuration] })
 */
function parseList(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function stripTrailingSlashes(value: string | undefined): string {
  return (value ?? '').replace(/\/+$/, '');
}

function parseInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export default () => {
  const supabaseUrl = stripTrailingSlashes(process.env.SUPABASE_URL);
  const corsOrigins = parseList(process.env.CORS_ORIGINS);

  return {
    app: {
      commissionBps: parseInteger(process.env.APP_COMMISSION_BPS, 500),
      version: process.env.APP_VERSION ?? '0.0.0',
      corsOrigins: corsOrigins.length > 0 ? corsOrigins : ['http://localhost:3000'],
      idempotencyTtlHours: parseInteger(process.env.IDEMPOTENCY_TTL_HOURS, 24),
      /**
       * Origin công khai của API, dùng để dựng `buyPath` tuyệt đối trong
       * response catalog. Để trống thì trả đường dẫn tương đối - đúng cho
       * cùng-origin và cho dev.
       */
      publicApiOrigin: stripTrailingSlashes(process.env.PUBLIC_API_ORIGIN),
    },
    catalog: {
      /**
       * Item NOT_SEEN quá số ngày này thì bị ẩn khỏi showroom (docs 2.5).
       */
      notSeenHideDays: parseInteger(process.env.SHOPEE_ITEM_HIDE_AFTER_DAYS, 7),
    },
    analytics: {
      /** Salt cho hash IP/user-agent trong OutboundClick (không lưu dữ liệu thô). */
      hashSalt: process.env.ANALYTICS_HASH_SALT ?? 'tnc-local-salt',
    },
    shopee: {
      /** 'csv' | 'affiliate' | 'open_platform' (S4/S5); S2 chỉ hiện thực 'csv'. */
      provider: process.env.SHOPEE_SYNC_PROVIDER ?? 'csv',
      /** Gian hàng mặc định khi import không gửi kèm field shopeeShopId. */
      shopId: process.env.SHOPEE_SHOP_ID ?? '',
      shopName: process.env.SHOPEE_SHOP_NAME ?? '',
      region: process.env.SHOPEE_REGION ?? 'vn',
      /** Storefront dùng để dựng deep-link sản phẩm. */
      storefrontBaseUrl: stripTrailingSlashes(process.env.SHOPEE_STOREFRONT_URL ?? 'https://shopee.vn'),
      /** Query nối vào deep-link mặc định (KHÔNG áp cho buyUrlOverride). */
      trackingSuffix: process.env.SHOPEE_BUY_URL_SUFFIX ?? '?utm_source=tnc_showroom',
      affiliateAppId: process.env.SHOPEE_AFFILIATE_APP_ID ?? '',
      affiliateSecret: process.env.SHOPEE_AFFILIATE_SECRET ?? '',
      affiliateEndpoint: stripTrailingSlashes(process.env.SHOPEE_AFFILIATE_ENDPOINT) || 'https://open-api.affiliate.shopee.vn/graphql',
      affiliateRefreshIntervalMs: parseInteger(process.env.SYNC_AFFILIATE_INTERVAL_MS, 4 * 60 * 60 * 1000),
    },
    meta: {
      accessToken: process.env.META_ACCESS_TOKEN ?? '',
      facebookPageId: process.env.META_FACEBOOK_PAGE_ID ?? '',
      instagramAccountId: process.env.META_INSTAGRAM_ACCOUNT_ID ?? '',
      graphVersion: process.env.META_GRAPH_VERSION ?? 'v26.0',
    },
    auth: {
      /** Supabase project URL; the JWKS URL and issuer are derived from it. */
      supabaseUrl,
      /** Legacy HS256 shared secret. Empty when the project uses signing keys. */
      jwtSecret: process.env.SUPABASE_JWT_SECRET ?? '',
      /** Explicit overrides, mainly for tests and non-standard deployments. */
      jwksUrl: stripTrailingSlashes(process.env.SUPABASE_JWKS_URL),
      issuer: stripTrailingSlashes(process.env.SUPABASE_JWT_ISSUER),
      audience: process.env.SUPABASE_JWT_AUDIENCE ?? 'authenticated',
      clockToleranceSeconds: parseInteger(process.env.AUTH_CLOCK_TOLERANCE_SECONDS, 30),
      jwksCacheTtlSeconds: parseInteger(process.env.AUTH_JWKS_CACHE_TTL_SECONDS, 300),
    },
  };
};
