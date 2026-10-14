# Backend Redefinition — Showroom & Shopee Sync

> **Trạng thái:** đặc tả chốt ngày 2026-10-14 theo định hướng của chủ dự án.
> Tài liệu này **xác định lại mô hình hệ thống** và thay thế các phần
> wallet / escrow / orders / payment trong bộ đặc tả `00–14` và trong code hiện có
> (`src/modules/banking`, `src/modules/wallet`, `src/modules/orders`).
> Đọc trước khi làm bất kỳ việc gì liên quan backend.

## 1. Mô hình mới (chốt)

TNC Web Platform hoạt động như một **showroom trưng bày & tuyển chọn**:

1. Khách truy cập web chỉ để **xem, tìm hiểu, đánh giá** sản phẩm (mới + pre-loved).
2. Nút **Mua** là **deep-link** sang đúng listing của sản phẩm đó trên **gian hàng Shopee** của TNC (mở tab mới).
3. **Toàn bộ nghiệp vụ thương mại diễn ra trên Shopee:** thanh toán, vận chuyển, hoàn tiền, chăm sóc sau bán, bảo mật giao dịch.
4. Backend TNC **không xử lý tiền**, không có wallet/escrow/đơn hàng nội bộ.
5. Bài toán kỹ thuật trọng tâm: **đồng bộ dữ liệu mặt hàng giữa showroom và gian hàng Shopee** để thông tin hiển thị (tên, giá, ảnh, trạng thái bán) luôn khớp với Shopee.

### 1.1. Luồng mua hàng (mới)

```text
┌──────────┐  xem sản phẩm   ┌───────────────────────┐  bấm "Mua trên Shopee"  ┌────────────────┐
│ Shopper  │ ──────────────▶ │ TNC Showroom          │ ──────────────────────▶ │ Shopee shop    │
│ (browser)│                 │ Next.js + NestJS      │   302 / link mở tab mới │ (checkout,     │
└──────────┘                 │ + Supabase            │ ◀────────────────────── │  thanh toán)   │
                             └───────────┬───────────┘   đồng bộ mặt hàng      └────────────────┘
                                         │                 (CSV / Affiliate / Open Platform)
                                         ▼
                                  Postgres (Supabase)
                                  catalog mirror + curation
```

### 1.2. Hệ quả với hệ thống hiện có

| Thành phần hiện có | Quyết định | Ghi chú |
| ------------------ | ---------- | ------- |
| `banking` (ledger, escrow, phí, ví hệ thống) | ❌ Gỡ (Phase 3, sau xác nhận) | Không phát triển thêm; giữ code trong lúc chuyển tiếp |
| `wallet` (`GET /wallet`, `/wallet/statement`, topup/withdraw) | ❌ Gỡ | Không còn nguồn tiền nội bộ |
| `orders` + `POST /orders/{id}/pay-wallet` | ❌ Gỡ | Đơn hàng nằm trên Shopee |
| Idempotency interceptor | ✅ Giữ hạ tầng | Dùng cho POST admin (import/sync), không dùng cho money |
| `identity` (`/me`), `health` (`/health`, `/health/db`) | ✅ Giữ nguyên | |
| Auth guard (Supabase JWT), `@Roles`, ProblemDetail RFC 7807 | ✅ Giữ nguyên | |
| Quy trình **duyệt nội dung** của staff | ✅ Giữ, đổi vai trò | Từ "duyệt listing để bán" → "duyệt/tuyển chọn nội dung hiển thị trên showroom" |
| Supabase Storage | ✅ Giữ, tăng vai trò | Mirror ảnh sản phẩm từ Shopee + lưu file import |

## 2. Đồng bộ dữ liệu Shopee

### 2.1. Các phương án khả thi (đã khảo sát 2026-10-14)

| # | Phương án | Dữ liệu lấy được | Yêu cầu | Đánh giá |
| - | --------- | ---------------- | ------- | -------- |
| A | **CSV/Excel export từ Shopee Seller Center** (Mass Upload Template: Validate → Export) | Toàn bộ danh sách sản phẩm của shop: tên, giá, tồn kho, SKU, trạng thái, ảnh | Tài khoản seller Shopee VN (đã có) | ✅ Tin cậy, không phụ thuộc duyệt API. Nhược điểm: **thủ công**, dữ liệu "tĩnh" theo lần export. **Chọn làm MVP.** |
| B | **Shopee Affiliate Open API** (`https://open-api.affiliate.shopee.vn/graphql`) | Feed sản phẩm: `productId`, `productName`, `price`, `imageUrl`, `offerLink`, `shopName`, `soldCount`, `ratingStar`, `commissionRate`; tạo link rút gọn qua `generateShortLink` | Đăng ký tài khoản Shopee Affiliate → App ID + Secret | ✅ Tốt cho **giá, ảnh, link mua có tracking**; có thể **không có tồn kho** → không thay thế hoàn toàn phương án A. |
| C | **Shopee Open Platform v2 (seller app)** | Đầy đủ nhất: `product.get_item_list` (phân trang, lọc `item_status`, incremental theo `update_time_from/to`), `product.get_item_base_info` (tối đa 50 item/lần), `product.get_model_list` (biến thể), tồn kho/giá realtime, **Push Mechanism (webhook)** khi giá/tồn/đơn thay đổi | Đăng ký developer + **verify profile** + ủy quyền shop (OAuth) + khai báo IP whitelist | ✅ Chuẩn nhất về lâu dài. Nhược điểm: cần được duyệt; chứng thực chữ ký HMAC-SHA256 cho mọi request; rate limit + quota ngày (`error_rate_limit`, `error_limit`). **Làm khi được duyệt.** |
| D | Scraping web Shopee | — | — | ❌ **Loại.** Vi phạm ToS, dữ liệu tồn kho không đáng tin khi không đăng nhập, rủi ro pháp lý. |

### 2.2. Chiến lược chốt — 3 giai đoạn

1. **Giai đoạn 1 (MVP):** Import CSV/Excel từ Seller Center + lớp curation thủ công. Toàn bộ luồng sync chạy được ngay, không phụ thuộc API.
2. **Giai đoạn 2:** Bổ sung provider **Affiliate** để tự động hoá giá/ảnh + sinh **affiliate link** cho nút mua (cold start: link canonical `https://shopee.vn/product/{shop_id}/{item_id}` vẫn dùng được khi chưa có affiliate).
3. **Giai đoạn 3:** Provider **Open Platform** khi app được duyệt: incremental sync tự động + webhook near-realtime + (tuỳ chọn) đẩy ngược showroom → Shopee (`update_price`, `update_stock`).

### 2.3. Kiến trúc provider (pluggable)

```ts
// src/modules/shopee/providers/shopee-sync-provider.interface.ts
export interface ItemSnapshot {
  shopeeItemId: string;
  name: string;
  status: 'NORMAL' | 'UNLIST' | 'BANNED' | 'DELETED';
  price?: string;          // Decimal dạng string
  stock?: number;
  imageUrls: string[];
  shopeeUpdateTime?: Date;
  models?: { modelId: string; name: string; price?: string; stock?: number }[];
  raw: unknown;            // payload gốc để audit
}

export interface ShopeeSyncProvider {
  readonly name: 'csv' | 'affiliate' | 'open_platform';
  fetchCatalog(cursor?: SyncCursor): Promise<{ items: ItemSnapshot[]; nextCursor?: SyncCursor }>;
  buildBuyUrl(item: { shopeeShopId: string; shopeeItemId: string }): Promise<string> | string;
}
```

- Provider chọn qua env `SHOPEE_SYNC_PROVIDER` (`csv` | `affiliate` | `open_platform`).
- Sync engine (`src/modules/sync`) không biết provider nào — chỉ nhận `ItemSnapshot[]` và thực hiện upsert + diff + policy.
- Đã hiện thực ở S2 (`src/modules/shopee`, `src/modules/sync`) — chi tiết & khác biệt so với sketch ở mục 9.

### 2.4. Chi tiết kỹ thuật từng provider

#### A. CSV / Excel (MVP)

- Nguồn file: Seller Center → **Mass Upload** → `Validate` → `Export` (file `Shopee_mass_upload_product_list_*.xls`).
- API admin: `POST /admin/shopee/import` (multipart) → lưu file gốc vào Supabase Storage bucket `sync-imports` → parse → staging diff → apply.
- Parser dung sai: hỗ trợ tên cột VN/EN, bỏ qua dòng trống, ghi lỗi từng dòng vào `sync_errors` (không fail cả file).
- Quy tắc diff khi import:
  - `item_id` chưa tồn tại → tạo `shopee_items` mới (trạng thái "mới, chờ gắn showroom").
  - Đã tồn tại → so `content_hash` (tên + giá + tồn + trạng thái + ảnh) → cập nhật field đổi + ghi log.
  - Có trong DB nhưng **không có trong file** → đánh dấu `NOT_SEEN`, chưa ẩn ngay; quá `N` ngày (mặc định 7) → policy ẩn (`HIDDEN_BY_SYNC`) + cảnh báo admin.

#### B. Affiliate Open API

- Endpoint: `POST https://open-api.affiliate.shopee.vn/graphql`; xác thực header `Authorization` theo format tài liệu, **chữ ký = SHA256(app_id + timestamp + payload + secret)**.
- Query `productOfferV2` (lọc theo shop qua `matchId` + `listType` tương ứng ShopId), phân trang `page`/`limit`; mutation `generateShortLink` cho link mua.
- Vì feed có thể thiếu tồn kho: **chỉ dùng để refresh giá/ảnh/link**, không dùng làm nguồn trạng thái bán. Kết hợp A cho tồn kho.

#### C. Open Platform v2 (khi được duyệt)

- Auth: tạo app trên console → `partner_id` + `partner_key`; shop ủy quyền qua auth URL → nhận `code` → đổi lấy `access_token` (+ `refresh_token`) theo từng `shop_id`; refresh định kỳ. **Token lưu mã hoá at-rest.**
- Ký mọi request: `sign = HMAC_SHA256(partner_key, partner_id + path + timestamp (+ access_token + shop_id))`.
- Đọc: `product.get_item_list` (offset, page_size, `item_status` ∈ NORMAL/UNLIST/BANNED/DELETED, `update_time_from`/`update_time_to` → chạy incremental theo con trỏ thời gian), `product.get_item_base_info` (batch ≤ 50), `product.get_model_list`.
- Ghi (tuỳ chọn, phase sau): `update_price`, `update_stock`, `update_item`.
- Push Mechanism: callback URL + verify chữ ký theo tài liệu; xử lý các event giá/tồn/đơn. Yêu cầu khai báo **IP whitelist** trên console.
- Tuân thủ rate limit: queue + backoff mũ + jitter khi gặp `error_rate_limit`; theo dõi quota ngày (`error_limit`).

### 2.5. Quy tắc map & xung đột dữ liệu

| Trường | Nguồn sự thật | Ghi chú |
| ------ | ------------- | ------- |
| Giá, tồn kho, trạng thái bán | **Shopee** | Showroom chỉ hiển thị lại; giá kèm chú thích "tham khảo" |
| Tên sản phẩm | **Shopee** (mặc định) | `display_title` của showroom được phép đè nếu có |
| Ảnh | **Shopee** (gốc) | Mirror về Supabase Storage khi sync để tránh hotlink |
| collection, badges, tình trạng (pre-loved), QA copy, thứ tự nổi bật, slug | **Showroom** | Không bị sync ghi đè |
| Trạng thái hiển thị | Suy ra | `BANNED`/`DELETED` → ẩn ngay; `NOT_SEEN` > N ngày → ẩn |

Bất biến: **sync không bao giờ xoá cứng** dữ liệu; mọi thay đổi trạng thái do sync phải xuất hiện trong `sync_runs` + `sync_errors` và có thể audit.

## 3. Mô hình dữ liệu mới (sketch Prisma)

> Chi tiết chốt khi implement; các bảng cũ (wallets, ledger_...) giữ nguyên đến Phase 3.

```prisma
model ShopeeShop {
  id            String   @id @default(uuid())
  shopeeShopId  BigInt   @unique
  name          String
  region        String   @default("vn")
  lastSyncAt    DateTime?
  items         ShopeeItem[]
  runs          SyncRun[]
}

model ShopeeItem {
  id               String   @id @default(uuid())
  shopId           String
  itemId           BigInt
  itemName         String
  itemStatus       String   // NORMAL | UNLIST | BANNED | DELETED | NOT_SEEN
  price            Decimal? @db.Decimal(12, 2)
  priceMin         Decimal? @db.Decimal(12, 2)
  priceMax         Decimal? @db.Decimal(12, 2)
  stock            Int?
  hasModel         Boolean  @default(false)
  categoryId       BigInt?
  imageUrls        Json     @default("[]")
  description      String?
  shopeeUpdateTime DateTime?
  contentHash      String
  raw              Json?
  firstSeenAt      DateTime @default(now())
  lastSeenAt       DateTime
  product          Product?
  models           ShopeeItemModel[]
  @@unique([shopId, itemId])
}

model ShopeeItemModel {
  id        String  @id @default(uuid())
  itemRefId String
  modelId   BigInt
  name      String
  price     Decimal? @db.Decimal(12, 2)
  stock     Int?
  @@unique([itemRefId, modelId])
}

model Collection {
  id       String    @id @default(uuid())
  slug     String    @unique  // pristine-retail | curated-preloved
  title    String
  theme    Json?
  products Product[]
}

model Product {
  id               String   @id @default(uuid())
  slug             String   @unique
  shopeeItemId     String?  @unique
  collectionId     String
  displayTitle     String?
  blurb            String?
  conditionPercent Int?     // pre-loved: % còn lại
  sealStatus       String?  // nguyên seal | đã mở | đã quẹt thử...
  qaNotes          Json?    // vệ sinh/UV, nguồn gốc, chính hãng
  badges           Json     @default("[]")
  visibility       String   @default("DRAFT") // DRAFT | PUBLISHED | HIDDEN_BY_SYNC
  featuredRank     Int?
  buyUrlOverride   String?  // link affiliate riêng (nếu có)
  publishedAt      DateTime?
}

model SyncRun {
  id         String      @id @default(uuid())
  provider   String      // CSV | AFFILIATE | OPEN_PLATFORM
  mode       String      // FULL | INCREMENTAL | MANUAL_IMPORT
  status     String      // RUNNING | SUCCEEDED | FAILED | PARTIAL
  stats      Json?
  startedAt  DateTime    @default(now())
  finishedAt DateTime?
  errors     SyncError[]
}

model SyncError {
  id      String @id @default(uuid())
  runId   String
  itemRef String?
  code    String
  message String
  raw     Json?
}

model OutboundClick {
  id         String   @id @default(uuid())
  productId  String
  occurredAt DateTime @default(now())
  uaHash     String?
  ipHash     String?
  referrer   String?
}

model ShopeeCredential { // chỉ dùng cho Open Platform
  id           String   @id @default(uuid())
  shopId       String   @unique
  accessToken  String   // mã hoá at-rest
  refreshToken String
  expiresAt    DateTime
  updatedAt    DateTime @updatedAt
}
```

## 4. Module & API

### 4.1. Module NestJS (đích)

| Module | Vai trò |
| ------ | ------- |
| `catalog` | Đọc công khai: danh sách + chi tiết sản phẩm, collections, filter/sort |
| `shopee` | Provider implementations (csv/affiliate/open_platform), client + ký request, token store |
| `sync` | Sync engine: run, diff, policy, reconciliation, logging |
| `curation` | Admin gắn/thuộc tính showroom lên item, publish/unpublish, duyệt pre-loved |
| `analytics` | Ghi nhận outbound click |
| giữ nguyên | `identity`, `health`, `auth guard`, `common/http`, `common/auth` |
| gỡ (Phase 3) | `banking`, `wallet`, `orders` (+ money idempotency) |

### 4.2. API công khai (đích)

| Endpoint | Mô tả |
| -------- | ----- |
| `GET /api/v1/catalog/collections` | Danh sách collection + hero content |
| `GET /api/v1/catalog/products?collection=&q=&category=&condition_min=&price_min=&price_max=&in_stock=&sort=&cursor=` | Danh sách sản phẩm published (keyset cursor) |
| `GET /api/v1/catalog/products/{slug}` | Chi tiết sản phẩm (kèm `shopee` block + `buyPath`) |
| `GET /api/v1/catalog/products/{id}/buy` | Ghi nhận click + `302` sang Shopee (deep-link) |
| `POST /api/v1/catalog/products/{id}/click` | Biến thể cho SPA: trả `{ url }` để `window.open`, ghi nhận click |

Ví dụ `GET /catalog/products/{slug}`:

```json
{
  "id": "9f1c…",
  "slug": "son-mac-chili-95",
  "collection": "curated-preloved",
  "condition": { "percentLeft": 95, "seal": "opened", "badges": ["95% Left", "Box Damaged"] },
  "qa": { "sterilized": "UV-C 2026-10-01", "origin": "Mua tại MAC Vincom", "authenticity": "verified" },
  "shopee": {
    "itemId": "1589295236",
    "shopId": "38003654",
    "price": "450000",
    "stock": 1,
    "status": "NORMAL",
    "url": "https://shopee.vn/product/38003654/1589295236",
    "syncedAt": "2026-10-14T08:00:00Z"
  },
  "buyPath": "/api/v1/catalog/products/9f1c…/buy"
}
```

Ghi chú: `price` trả dạng **string** như quy ước tiền tệ hiện có; nếu sản phẩm `HIDDEN_BY_SYNC` → trả `410 Gone` với `code=PRODUCT_UNLISTED`.

### 4.3. API admin (đích)

| Endpoint | Mô tả |
| -------- | ----- |
| `POST /api/v1/admin/shopee/import` | Upload file CSV/Excel (multipart) → sync run `MANUAL_IMPORT` — ✅ S2 |
| `POST /api/v1/admin/sync/run` | Trigger sync (body: `provider`, `mode=full|incremental`) |
| `GET /api/v1/admin/sync/runs` / `GET /api/v1/admin/sync/runs/{id}` | Lịch sử + chi tiết (kèm errors) |
| `GET /api/v1/admin/shopee/items?status=&q=` | Danh sách item staging để chọn đưa lên showroom |
| `POST /api/v1/admin/products` | Tạo product showroom từ item (gắn collection, badge, QA) |
| `PATCH /api/v1/admin/products/{id}` | Sửa curation fields |
| `POST /api/v1/admin/products/{id}/publish` / `/unpublish` | Publish/unpublish |

- Role: `ADMIN`/`STAFF`; mọi POST kèm `Idempotency-Key` (hạ tầng có sẵn).
- Lỗi theo RFC 7807 + `code` ổn định.

### 4.4. Bổ sung error catalog

| code | HTTP | Khi nào |
| ---- | ---- | ------- |
| `SYNC_ALREADY_RUNNING` | 409 | Trigger sync khi đang có run chạy |
| `SHOPEE_NOT_CONNECTED` | 409 | Provider affiliate/open_platform chưa cấu hình credential |
| `IMPORT_FILE_INVALID` | 422 | File import sai định dạng/không đọc được |
| `IMPORT_COLUMNS_MISSING` | 422 | Thiếu cột bắt buộc trong file export |
| `ITEM_NOT_LINKED` | 409 | Publish product chưa gắn item Shopee |
| `PRODUCT_UNLISTED` | 410 | Sản phẩm đã bị ẩn do sync (BANNED/DELETED/NOT_SEEN) |

## 5. Vận hành sync

| Việc | Cơ chế | Tần suất |
| ---- | ------ | -------- |
| Import CSV | Admin upload tay | Khi cập nhật hàng loạt (giá, thêm/xoá sản phẩm) |
| Affiliate refresh | `@nestjs/schedule` (cron) | 2–4 lần/ngày |
| Open Platform incremental | Cron + con trỏ `update_time_from` | 15–30 phút |
| Webhook (Open Platform) | Callback + verify sign | Near-realtime |
| Reconciliation | Cron full diff (đối chiếu DB ↔ Shopee) | 1 lần/tuần + báo cáo |

Nguyên tắc: mọi lần chạy tạo `sync_runs`; lỗi không làm hỏng dữ liệu cũ; retry có backoff; admin nhận cảnh báo khi run thất bại hoặc có item đổi trạng thái quan trọng.

Env vars mới (dự kiến): `SHOPEE_SYNC_PROVIDER`, `SHOPEE_SHOP_ID`, `SHOPEE_AFFILIATE_APP_ID`, `SHOPEE_AFFILIATE_SECRET`, `SHOPEE_PARTNER_ID`, `SHOPEE_PARTNER_KEY`, `SHOPEE_REGION=vn`, `SYNC_CRON_*`.

## 6. Lộ trình triển khai

| Sprint | Nội dung | Deliverable |
| ------ | -------- | ----------- |
| S2 ✅ | Schema mới + sync engine lõi + **provider CSV** + `POST /admin/shopee/import` + run logging | Đã xong 2026-10-14 — import file thật từ Seller Center chạy được, có test (28 unit + 90 e2e) |
| S3 ✅ | **Catalog read API** (list/detail/filter/cursor) + `buy` redirect + click analytics + curation API | Đã có trong repo; e2e catalog/curation nằm trong bộ kiểm thử HTTP |
| S4 🟨 | Provider **Affiliate** (feed + `generateShortLink`) + endpoint chạy tay + scheduler | Đã có code/test; cần cấu hình credentials và hoàn thiện báo cáo reconciliation trước khi bật production |
| S5 | Provider **Open Platform** (nếu được duyệt) + webhook + (tuỳ chọn) đẩy ngược | Sync tự động đầy đủ |
| Phase 3 | Gỡ `banking`/`wallet`/`orders` + drop bảng cũ (sau xác nhận) | Repo sạch theo mô hình mới |

## 7. Câu hỏi mở cần chủ dự án chốt

1. **Open Platform**: có thể đăng ký developer + verify profile với Shopee không? (quyết định S5 có khả thi)
2. **Affiliate**: đã có/đăng ký được tài khoản Shopee Affiliate chưa? (quyết định S4)
3. **Phạm vi hiển thị**: toàn bộ sản phẩm của shop hay chỉ một tập tuyển chọn lên showroom?
4. **Pre-loved**: mỗi món pre-loved có một listing Shopee riêng để deep-link không? (nếu chính sách Shopee không cho bán hàng đã dùng, cần phương án "liên hệ" riêng cho nhóm này)
5. **Gỡ code cũ**: xác nhận thời điểm gỡ `banking`/`wallet`/`orders` và drop bảng liên quan.
6. **Ảnh**: mirror về Supabase Storage (khuyến nghị) hay hotlink CDN Shopee?
7. **Giá hiển thị**: hiển thị giá sync kèm chú thích "tham khảo", hay ẩn giá, chỉ để nút "Mua trên Shopee"?

## 8. Tài liệu liên quan

- [02_System_Architecture.md](../Spectification/TNCWebPlatform/02_System_Architecture.md) — kiến trúc tổng thể (đã đánh dấu revision)
- [07_Frontend.md](../Spectification/TNCWebPlatform/07_Frontend.md) + [FRONTEND_DESIGN_BRIEF.md](../frontend/FRONTEND_DESIGN_BRIEF.md) — frontend (CTA mua qua Shopee)
- [11_API_Specification.md](../Spectification/TNCWebPlatform/11_API_Specification.md) — API hiện có (một phần thuộc mô hình cũ)
- [database/DATABASE.md](../database/DATABASE.md) — schema hiện tại
- [SPRINT_SETUP_AND_ENDPOINT_TESTING.md](../SPRINT_SETUP_AND_ENDPOINT_TESTING.md) — sprint S1 (mô hình cũ, tạm dừng)

## 9. Ghi chú triển khai S2 (đã xong 2026-10-14)

### 9.1. File đã thêm

| File | Vai trò |
| ---- | ------- |
| `src/modules/shopee/providers/shopee-sync-provider.interface.ts` | Hợp đồng provider: `ItemSnapshot`, `ItemModelSnapshot`, `SyncCursor`, `ShopeeSyncProvider` |
| `src/modules/shopee/shopee.constants.ts` | Alias cột VN/EN (chuẩn hoá bỏ dấu), alias trạng thái, giới hạn file/dòng |
| `src/modules/shopee/providers/csv/csv-values.ts` | Bóc ô ExcelJS; parse id/giá (định dạng VN–EN)/tồn; tách URL ảnh |
| `src/modules/shopee/providers/csv/csv-shopee.provider.ts` | Parse xlsx/csv → `ItemSnapshot[]`; gom dòng phân loại; lỗi từng dòng không làm hỏng file |
| `src/modules/shopee/shopee.module.ts` | Cung cấp `CsvShopeeProvider` |
| `src/modules/sync/sync.service.ts` | Sync engine: upsert theo `(shopId, itemId)`, content hash, NOT_SEEN, `SyncRun`/`SyncError` |
| `src/modules/sync/sync-admin.controller.ts` | `POST /admin/shopee/import` (multipart, STAFF/ADMIN, Idempotency-Key) |
| `src/modules/sync/dto/shopee-import.dto.ts` | Form fields `shopeeShopId`, `shopName` |

### 9.2. Hợp đồng endpoint

`POST /api/v1/admin/shopee/import` — `multipart/form-data`, role `STAFF`/`ADMIN`,
bắt buộc header `Idempotency-Key` (retry mạng không tạo run thứ hai; muốn import
file mới thì dùng key mới):

| Part | Kiểu | Ghi chú |
| ---- | ---- | ------- |
| `file` | `.xlsx` / `.csv`, ≤ 10 MB | Export từ Seller Center (Mass Upload → Validate → Export). `.xls` (Excel 97-2003) chưa hỗ trợ |
| `shopeeShopId` | chuỗi số, tuỳ chọn | Bỏ trống thì lấy `SHOPEE_SHOP_ID` |
| `shopName` | chuỗi, tuỳ chọn | Chỉ dùng khi shop được tạo lần đầu |

Response `200`:

```json
{
  "runId": "…",
  "status": "SUCCEEDED | PARTIAL",
  "shop": { "id": "…", "shopeeShopId": "38003654" },
  "stats": { "receivedRows": 120, "itemsParsed": 118, "created": 5, "updated": 61,
             "unchanged": 52, "errors": 2, "notSeen": 3 },
  "columns": { "itemId": "ID sản phẩm", "name": "Tên sản phẩm" },
  "warnings": [ { "row": 17, "code": "INVALID_PRICE", "message": "…" } ],
  "warningCount": 2
}
```

- Lỗi cấp file (`422 IMPORT_FILE_INVALID` / `422 IMPORT_COLUMNS_MISSING`) →
  **không** tạo `SyncRun`.
- Lỗi cấp dòng → run `PARTIAL`, lỗi lưu ở `SyncError` + trả trong `warnings`
  (tối đa 50; DB vẫn lưu đủ).
- Đang có run chạy → `409 SYNC_ALREADY_RUNNING`; run `RUNNING` quá 30 phút bị
  coi là stale, tự đánh `FAILED` rồi lần import mới được chạy tiếp.

### 9.3. Quyết định triển khai (khác sketch ban đầu)

- `buildBuyUrl` nhận cả `shopeeShopId` — URL canonical là
  `https://shopee.vn/product/{shopId}/{itemId}` (sketch mục 2.3 đã chỉnh theo).
- `ShopeeItemModel.modelId` là **chuỗi**: cột "Mã phân loại" của template có thể
  là SKU chữ do người bán đặt, không chỉ ID số của Shopee.
- CSV đọc với `map` giữ nguyên chuỗi: mặc định ExcelJS tự đổi `"450.000"` → `450`
  và ô `" "` → `0`, làm sai giá VN; parser tự diễn giải định dạng (`450.000`,
  `1.234.567,89`, ô số của Excel).
- Provider chọn qua DI: S2 chỉ đăng ký `CsvShopeeProvider`; env
  `SHOPEE_SYNC_PROVIDER` vẫn được đọc — giá trị khác `csv` trả
  `SHOPEE_NOT_CONNECTED` cho tới khi S4/S5 hiện thực provider tương ứng.
- Dòng có item id hợp lệ nhưng field khác lỗi vẫn được tính là "đã thấy"
  (`ParsedCatalog.seenItemIds`) — tránh đánh `NOT_SEEN` nhầm mặt hàng còn bán.
- Ghi theo chunk 100 item/transaction; lỗi giữa chừng ⇒ run `FAILED` (các chunk
  đã commit được giữ nguyên, có `SyncError` code `RUN_FAILED` để truy vết).

## 10. Ghi chú triển khai S3 (đã có trong repo)

- `src/modules/catalog` cung cấp collection, danh sách sản phẩm public với
  filter/search/sort/keyset cursor, PDP, `GET .../buy` redirect 302 và
  `POST .../click` cho SPA.
- Public response chỉ chứa sản phẩm `PUBLISHED` còn khả dụng; sản phẩm bị
  Shopee `BANNED`/`DELETED` hoặc quá hạn `NOT_SEEN` trả `410 PRODUCT_UNLISTED`.
- `price` trả dạng chuỗi Decimal; `buyPath` hỗ trợ origin tương đối hoặc
  `PUBLIC_API_ORIGIN`; URL Shopee mặc định gắn suffix tracking.
- Analytics lưu hash SHA-256 có salt cho IP/user-agent, không giữ raw values;
  lỗi analytics không chặn chuyển khách sang Shopee.
- `src/modules/curation` cung cấp staging list, danh sách admin, tạo/cập nhật
  product, publish/unpublish; các thao tác POST có `Idempotency-Key`, mọi thay
  đổi curation được ghi `AuditLog`.
- E2E hiện kiểm chứng API catalog/curation cùng các suite HTTP khác; lần chạy
  gần nhất: 10 suite, 124 test pass (2026-10-14).

## 11. Tiến độ S4 (Affiliate)

- Đã thêm `AffiliateShopeeProvider`: ký body JSON đúng thứ tự
  `SHA256(appId + timestamp + payload + secret)`, lấy trang `productOfferV2`
  và tạo link qua `generateShortLink`.
- `POST /api/v1/admin/sync/run` nhận provider `affiliate` và mode
  `full|incremental`; cần cấu hình `SHOPEE_SYNC_PROVIDER=affiliate`,
  `SHOPEE_SHOP_ID`, `SHOPEE_AFFILIATE_APP_ID` và
  `SHOPEE_AFFILIATE_SECRET`. Secret chỉ đặt trong environment/secret manager.
- Scheduler process-local chạy mỗi 4 giờ (có thể chỉnh
  `SYNC_AFFILIATE_INTERVAL_MS`) khi đủ cấu hình; không chạy nếu thiếu shop ID
  hoặc credentials.
- Migration thêm `ShopeeItem.affiliateUrl`; link này được ưu tiên làm link mua
  sau `buyUrlOverride` của staff và trước URL canonical.
- Feed Affiliate không có tồn kho/trạng thái bán đủ tin cậy. Sync giữ nguyên
  `stock`/`itemStatus` ở item đã biết, không đánh `NOT_SEEN` khi feed không có
  item; các trường đó tiếp tục do CSV Seller Center quản lý. Vì vậy chưa thể
  dùng Affiliate làm full reconciliation hoặc tự ẩn item thiếu trong feed.
- Unit + e2e xác nhận chữ ký, phân trang, cập nhật giá/ảnh/link, và giữ nguyên
  tồn kho/trạng thái; lần chạy gần nhất: 5 unit suite / 46 test và 11 e2e suite /
  125 test pass (2026-10-14). Chưa gọi Shopee thật; bật production sau khi
  secrets được cấu hình và xác nhận query fields với Affiliate Open API Explorer.
