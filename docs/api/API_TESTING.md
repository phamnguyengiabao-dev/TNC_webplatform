# TNC Web Platform - API Endpoint Testing

Tài liệu này là bộ kịch bản kiểm thử endpoint của TNC Web Platform, dùng cho
Postman/curl, đối chiếu hợp đồng tại
[11_API_Specification.md](../Spectification/TNCWebPlatform/11_API_Specification.md).

> **Trạng thái 2026-10-14:** tầng HTTP (`/api/v1`) đã chạy thật cho các endpoint
> mục 2, 3, 4 và 6.2 (`health`, `/me`, `/wallet`, `/wallet/statement`,
> `pay-wallet`) - 91/91 test tự động pass, smoke test bằng `node dist/main.js`
> đã chạy (xem `SPRINT_SETUP_AND_ENDPOINT_TESTING.md` mục 6.1). Các mục còn lại
> (topup/webhook, release/refund, rút tiền, listing, staff) vẫn là kịch bản viết
> sẵn cho sprint sau; chỗ nào phụ thuộc service đã có sẽ ghi rõ.

## 0. Base URL và biến môi trường Postman

Khi chạy local:

```text
BASE_URL=http://localhost:3000/api/v1
```

Khi deploy staging/production:

```text
BASE_URL=https://<api-domain>/api/v1
```

Bộ biến Postman khuyến nghị:

| Biến | Ví dụ | Mô tả |
| ---- | ----- | ----- |
| `BASE_URL` | `http://localhost:3000/api/v1` | Gốc API |
| `SUPABASE_URL` | `https://<ref>.supabase.co` | Để login lấy token |
| `ANON_KEY` | `<anon-key>` | apikey cho Supabase Auth |
| `BUYER_TOKEN` | JWT | Token buyer A |
| `SELLER_TOKEN` | JWT | Token seller B |
| `STAFF_TOKEN` | JWT | Token staff (role STAFF) |
| `ORDER_ID`, `TOPUP_ID`, `WITHDRAWAL_ID`, `LISTING_ID` | uuid | Điền tự động bằng test script/tests tab |
| `IDEMP_KEY` | uuid v4 | Sinh mới cho mỗi ý định; **không** đổi khi retry |

## 1. Lấy JWT từ Supabase

```bash
curl -s -X POST "$SUPABASE_URL/auth/v1/token?grant_type=password" \
  -H "apikey: $ANON_KEY" -H "Content-Type: application/json" \
  -d '{"email":"buyer-a@example.com","password":"<password>"}'
```

Kết quả: `access_token` chính là `BUYER_TOKEN` (Bearer cho mọi API nghiệp vụ).
Tài khoản test (buyer/seller/staff) tạo qua Supabase Auth; staff cần được set
`role = STAFF` trong `UserProfile` (SQL editor hoặc admin script).

## 2. Health

```http
GET {{BASE_URL}}/health
```

Kỳ vọng (đã có, giá trị `version` lấy từ `APP_VERSION`):

```json
{ "status": "ok", "version": "0.0.0" }
```

```http
GET {{BASE_URL}}/health/db
```

Kỳ vọng: ping database OK + tên migration head hiện tại, ví dụ:

```json
{ "status": "ok", "database": "ok", "migration": "20261014053909_finance_core", "latencyMs": 12 }
```

DB ping lỗi ⇒ `503 SERVICE_UNAVAILABLE` (không lộ chi tiết driver).

## 3. Danh tính - GET /me

```http
GET {{BASE_URL}}/me
Authorization: Bearer {{BUYER_TOKEN}}
```

Kỳ vọng:

```json
{
  "id": "...",
  "email": "buyer-a@example.com",
  "role": "USER",
  "isBlocked": false,
  "wallet": { "balance": "0", "currency": "VND" }
}
```

Kiểm tra lỗi bắt buộc:

| Case | Kỳ vọng |
| ---- | ------- |
| Không gửi token | `401 UNAUTHENTICATED` |
| Token hết hạn/sai chữ ký | `401 UNAUTHENTICATED` |
| Token của user `isBlocked` gọi endpoint tiền | `403 ACCOUNT_BLOCKED` |

## 4. Ví - số dư và sổ giao dịch

```http
GET {{BASE_URL}}/wallet
Authorization: Bearer {{BUYER_TOKEN}}
```

```http
GET {{BASE_URL}}/wallet/statement?take=20
Authorization: Bearer {{BUYER_TOKEN}}
```

Kỳ vọng: số dư dạng chuỗi; mỗi dòng sổ có `amount` (có dấu), `balanceAfter`,
`kind`, `createdAt` (ISO-8601 UTC). Lấy `nextCursor` của response gọi tiếp trang
sau; khi hết, `nextCursor = null`.

Kiểm tra bất biến thủ công trên database (song song khi test):

```sql
select * from "WalletReconciliation" where drift <> 0;  -- phải RỖNG
select * from "LedgerIntegrity";                        -- total_drift = 0
```

## 5. Nạp tiền - topup + webhook

### 5.1. Tạo top-up

```http
POST {{BASE_URL}}/wallet/topups
Authorization: Bearer {{BUYER_TOKEN}}
Idempotency-Key: {{IDEMP_KEY}}
Content-Type: application/json
```

```json
{ "amount": "100000", "provider": "PAYOS" }
```

Kỳ vọng: `201` với `id`, `status = PENDING`, `qrPayload`, `expiresAt`.
Gọi lại **cùng key + cùng body** ⇒ replay (header `Idempotent-Replayed: true`),
không tạo top-up thứ hai.

### 5.2. Mô phỏng webhook PSP

Webhook thật do PSP gọi; khi dev dùng sandbox hoặc ký thủ công theo tài liệu
provider (ví dụ PayOS: HMAC-SHA256 trên chuỗi dữ liệu với checksum key):

```bash
BODY='{"orderCode":123,"amount":100000,"reference":"FT240123456","description":"TNC-TOPUP-9f1c"}'
SIGNATURE=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$PAYOS_CHECKSUM_KEY" -hex | cut -d' ' -f2)

curl -s -X POST "{{BASE_URL}}/webhooks/payments/payos" \
  -H "Content-Type: application/json" --data "$BODY"
```

Kỳ vọng: `2xx`; ví buyer `+100000`; ledger có transfer `DEPOSIT` với
`externalRef = FT240123456`.

### 5.3. Replay (bắt buộc test)

Gửi **cùng webhook 3 lần** (tuần tự) và **3 lần đồng thời**:

- Kỳ vọng: số dư chỉ tăng **một lần**; các lần sau trả `applied: false`.
- Sai chữ ký: `401 WEBHOOK_SIGNATURE_INVALID`, không cộng tiền.

### 5.4. Poll trạng thái

```http
GET {{BASE_URL}}/wallet/topups/{{TOPUP_ID}}
Authorization: Bearer {{BUYER_TOKEN}}
```

Kỳ vọng: `PENDING → COMPLETED` (frontend poll mỗi 3 s đến khi xong/hết hạn).

## 6. Đơn hàng C2C - luồng escrow đầy đủ

Chuẩn bị: seller B có listing đã duyệt; buyer A có ví đủ tiền (nạp ở mục 5).

### 6.1. Tạo đơn

```http
POST {{BASE_URL}}/orders
Authorization: Bearer {{BUYER_TOKEN}}
Idempotency-Key: {{IDEMP_KEY}}
```

```json
{
  "items": [{ "productId": "{{LISTING_ID}}", "quantity": 1 }],
  "shipping": { "recipientName": "An", "phone": "0900000000", "address": "..." },
  "paymentMethod": "WALLET"
}
```

Kỳ vọng: `201`, `status = PENDING_PAYMENT`, `grossAmount` = giá listing,
`commissionAmount` = 5% (mặc định tạm), `expiresAt` ~10 phút.

### 6.2. Thanh toán bằng ví

```http
POST {{BASE_URL}}/orders/{{ORDER_ID}}/pay-wallet
Authorization: Bearer {{BUYER_TOKEN}}
Idempotency-Key: {{IDEMP_KEY_2}}
```

Kỳ vọng: `200` `status = PAID`, `applied = true`; số dư buyer giảm đúng gross;
listing `SOLD`; tiền trong `ESCROW` (kiểm tra bằng SQL:
`select balance from "Wallet" where code = 'ESCROW';`).

### 6.3. Các case lỗi bắt buộc

| Case | Chuẩn bị | Kỳ vọng |
| ---- | -------- | ------- |
| Thiếu tiền | Ví buyer nhỏ hơn giá | `409 INSUFFICIENT_FUNDS`; số dư không đổi |
| Double-click | Gọi pay-wallet 5 lần **song song** cùng một đơn | Đúng 1 request `applied: true`; còn lại replay; ledger chỉ có 1 `ORDER_PAYMENT` |
| Sai chủ đơn | Buyer C thanh toán đơn của A | `403 FORBIDDEN` |
| Đơn hết hạn giữ chỗ | Chờ quá `APP_RESERVATION_MINUTES` | `409 INVALID_STATE_TRANSITION`; đơn `CANCELLED`; tồn kho trả về |
| Hai buyer cùng mua | 2 buyer bấm mua cùng listing qty = 1 | 1 thắng; người sau nhận lỗi; không ai mất tiền |
## 7. Release / hoàn tiền (staff)

Điều kiện: đơn C2C đã `DELIVERED` (staff cập nhật giao vận trước).

```http
POST {{BASE_URL}}/staff/orders/{{ORDER_ID}}/release
Authorization: Bearer {{STAFF_TOKEN}}
Idempotency-Key: {{IDEMP_KEY}}
```

Kỳ vọng: `200`; ví seller `+ (gross − commission)`; `PLATFORM_REVENUE + commission`;
đơn `COMPLETED`; gọi lại ⇒ replay, **không** trả tiền hai lần.

Hoàn tiền (khi còn escrow):

```http
POST {{BASE_URL}}/staff/orders/{{ORDER_ID}}/refund
Authorization: Bearer {{STAFF_TOKEN}}
Idempotency-Key: {{IDEMP_KEY}}
Content-Type: application/json
```

```json
{ "reason": "Buyer cung cấp bằng chứng hàng sai mô tả" }
```

| Case | Kỳ vọng |
| ---- | ------- |
| Release khi đơn chưa `DELIVERED` | `409 INVALID_STATE_TRANSITION` |
| Refund sau khi đã release | `409 INVALID_STATE_TRANSITION` (không hoàn tiền tự động) |
| Release hai lần | Replay (idempotent), không double-pay |
| Buyer (không phải staff) gọi | `403 FORBIDDEN` |
| Gọi release cho đơn của đơn khác đã tiêu escrow | `409 ESCROW_EMPTY` (escrow isolation) |

## 8. Rút tiền - luồng duyệt đầy đủ

### 8.1. User tạo lệnh

```http
POST {{BASE_URL}}/withdrawals
Authorization: Bearer {{SELLER_TOKEN}}
Idempotency-Key: {{IDEMP_KEY}}
```

```json
{ "payoutMethodId": "{{PAYOUT_ID}}", "amount": "200000" }
```

Kỳ vọng: `201`, `status = REQUESTED`; **số dư chưa đổi** (debit chỉ ở approve).

### 8.2. Staff duyệt

```http
POST {{BASE_URL}}/staff/withdrawals/{{WITHDRAWAL_ID}}/approve
Authorization: Bearer {{STAFF_TOKEN}}
Idempotency-Key: {{IDEMP_KEY}}
```

Kỳ vọng: `200`; user `-200000`; `WITHDRAWAL_CLEARING +200000`; lệnh `APPROVED`;
`reviewedBy/reviewedAt` được set.

### 8.3. Settle hoặc Fail

```http
POST {{BASE_URL}}/staff/withdrawals/{{WITHDRAWAL_ID}}/settle
Authorization: Bearer {{STAFF_TOKEN}}
Idempotency-Key: {{IDEMP_KEY}}
```

Kỳ vọng: `WITHDRAWAL_CLEARING -200000`; `GATEWAY_CLEARING +200000`; `SETTLED`.

```http
POST {{BASE_URL}}/staff/withdrawals/{{WITHDRAWAL_ID}}/fail
Authorization: Bearer {{STAFF_TOKEN}}
Idempotency-Key: {{IDEMP_KEY}}
Content-Type: application/json
```

```json
{ "reason": "Sai số tài khoản người nhận" }
```

Kỳ vọng: transfer đảo hoàn `200000` về ví user; lệnh `FAILED`; tổng ledger = 0.

| Case | Kỳ vọng |
| ---- | ------- |
| Approve khi số dư không đủ | `409 INSUFFICIENT_FUNDS`; lệnh vẫn `REQUESTED` |
| Approve hai lần | Replay; không debit hai lần |
| Settle khi chưa `APPROVED` | `409 INVALID_STATE_TRANSITION` |
| Settle hai lần | Replay; không chi hai lần |
| User tự gọi endpoint staff | `403 FORBIDDEN` |

## 9. Kịch bản đồng thời (bắt buộc trước go-live)

### 9.1. 5 request thanh toán song song cùng một đơn

Bash:

```bash
seq 1 5 | xargs -P5 -I{} curl -s -o /dev/null -w "%{http_code}\n" \
  -X POST "$BASE_URL/orders/$ORDER_ID/pay-wallet" \
  -H "Authorization: Bearer $BUYER_TOKEN" -H "Idempotency-Key: key-{}"
```

PowerShell:

```powershell
1..5 | ForEach-Object -Parallel {
  Invoke-WebRequest -Method Post -Uri "$using:BASE_URL/orders/$using:ORDER_ID/pay-wallet" `
    -Headers @{ Authorization = "Bearer $using:BUYER_TOKEN"; "Idempotency-Key" = "key-$_" }
} -ThrottleLimit 5
```

Kỳ vọng: chỉ **một** giao dịch tiền (kiểm tra bằng SQL đếm transfer
`ORDER_PAYMENT` của đơn = 1, số dư buyer chỉ giảm một lần).

### 9.2. Webhook replay song song

Gửi cùng một webhook 3 luồng song song; kỳ vọng tổng cộng tiền đúng một lần -
tương đương test đã có (`deposit replay race ×3`).

## 10. Dữ liệu test và reset

- Local: chạy `npm test` - harness tự dựng PostgreSQL sạch, `migrate deploy`,
  chạy toàn bộ test rồi tắt server; không ảnh hưởng database khác.
- Staging: dùng dữ liệu seed riêng (buyer A/B, seller B, staff, listing đã
  duyệt); **không** test trên production.
- Reset ví test: nạp tiền qua PSP sandbox hoặc tạo ADJUSTMENT nội bộ có audit
  (chỉ môi trường staging).

## 11. Bằng chứng kiểm thử hiện có (test suite)

Chạy:

```bash
npm test            # 17 unit + 74 e2e = 91 test
npm run test:unit   # money/commission
npm run test:e2e    # ledger guards + banking + HTTP e2e (PostgreSQL thật)
```

| Bộ test | Số test | Chứng minh điều gì |
| ------- | ------- | ------------------ |
| `src/common/money.spec.ts` | 17 | `commission + seller = gross` với mọi mức phí; làm tròn HALF_UP; whole-đồng; biên 0%/100% |
| `test/ledger-guards.spec.ts` | (trong 74 e2e) | Transfer lệch/1 leg/leg trùng/0 đồng/phần lẻ không commit được; append-only; ví USER/ESCROW không âm; RLS chặn `anon`; reverse đúng và chặn đảo lần hai |
| `test/banking.spec.ts` | (trong 74 e2e) | Pay đồng thời ×5 ⇒ 1 thắng; 2 đơn tranh tiền ⇒ 1 `INSUFFICIENT_FUNDS`; replay thanh toán; webhook nạp replay ×3 + race ×3 ⇒ cộng 1 lần; release/refund đúng trạng thái; escrow isolation; withdrawal approve/settle/fail; statement keyset; **drift = 0 sau toàn bộ luồng** |
| `test/http/*.spec.ts` | (40 test HTTP) | Health + problem+json; auth 401/403/404 với token thiếu/sai/hết hạn/kid lạ/issuer sai/JWKS xoay key (ES256 server thật); `/me`; `/wallet` + statement keyset + validate query; pay-wallet: escrow, replay `Idempotent-Replayed`, conflict, thiếu tiền, retry cùng key, 403/404/409, drift = 0 cuối suite |

Kết quả kỳ vọng khi chạy: toàn bộ pass; log kết thúc có tổng ≥ 91 test xanh.
Bằng chứng lần chạy 2026-10-14: 91/91 pass; smoke test `node dist/main.js` theo
[../SPRINT_SETUP_AND_ENDPOINT_TESTING.md](../SPRINT_SETUP_AND_ENDPOINT_TESTING.md)
mục 6.1. Chi tiết phát hiện/sửa trong phiên thiết kế: xem
[../banking-design-review.md](../banking-design-review.md).

## 12. Checklist nghiệm thu API

Cập nhật 2026-10-14 sau sprint HTTP đầu tiên:

| # | Hạng mục | Tiêu chí | Trạng thái |
| - | -------- | -------- | ---------- |
| 1 | Health | `/health`, `/health/db` trả 2xx và thông tin migration head | ✅ |
| 2 | Auth | 401 khi thiếu/sai token; 403 đúng chỗ; role đọc từ DB | ✅ (route `@Roles` đầu tiên sẽ là `/staff/*`) |
| 3 | Idempotency | Mọi POST tiền replay đúng; khác payload ⇒ 409 | ✅ cho endpoint tiền đã có (`pay-wallet`); áp dụng tiếp cho topup/withdrawal khi viết |
| 4 | Ví | Số dư khớp ledger; statement phân trang cursor đúng | ✅ |
| 5 | Nạp tiền | Webhook verify chữ ký; replay không cộng hai lần | ⬜ tầng webhook HTTP (ledger replay đã test ở tầng service) |
| 6 | Đơn C2C | pay-wallet một transaction; không oversell; double-click an toàn | 🟨 pay-wallet ✅; `POST /orders`, cancel, confirm-received ở sprint S2 |
| 7 | Release/refund | Đúng trạng thái; escrow isolation; double-release an toàn | 🟨 service ✅ (đã test); HTTP staff endpoint ở sprint S4 |
| 8 | Rút tiền | Debit chỉ ở approve; settle/fail idempotent | 🟨 service ✅ (đã test); HTTP endpoint ở sprint S4 |
| 9 | Lỗi | Mọi lỗi theo RFC 7807 + `code` ổn định; không lộ dữ liệu nội bộ | ✅ |
| 10 | Đối soát | `LedgerIntegrity = 0`; `WalletReconciliation` rỗng sau toàn bộ kịch bản | ✅ assert tự động trong `test/http/orders-pay.spec.ts` |
| 11 | Test tự động | `npm test` xanh; test HTTP mới bổ sung cho từng endpoint | ✅ 91 test |

## 13. Tài liệu liên quan

- [11_API_Specification.md](../Spectification/TNCWebPlatform/11_API_Specification.md) - hợp đồng API
- [10_Use_Cases.md](../Spectification/TNCWebPlatform/10_Use_Cases.md) - luồng nghiệp vụ
- [database/DATABASE.md](../database/DATABASE.md) - schema, guards, câu lệnh đối soát
- [SPRINT_SETUP_AND_ENDPOINT_TESTING.md](../SPRINT_SETUP_AND_ENDPOINT_TESTING.md) - kế hoạch sprint HTTP

## 14. Sync Shopee (S2) - `POST /admin/shopee/import`

Import file export từ Shopee Seller Center (Mass Upload -> Validate -> Export).
Role `STAFF`/`ADMIN`; bắt buộc `Idempotency-Key`; đặc tả đầy đủ ở
[backend/SHOPEE_SHOWROOM_BACKEND.md](../backend/SHOPEE_SHOWROOM_BACKEND.md) mục 9.

Chuẩn bị: file `.xlsx`/`.csv` có tối thiểu cột **ID sản phẩm** (hoặc
"Mã sản phẩm"), **Tên sản phẩm**; các cột `Giá`, `Tồn kho`, `Ảnh 1..n`, `Trạng
thái`, `Mã phân loại`... là tuỳ chọn. `shopeeShopId` lấy từ URL
`shopee.vn/shop/{id}`.

```powershell
$token = '<JWT staff/admin>'
curl.exe -X POST "http://localhost:3000/api/v1/admin/shopee/import" `
  -H "Authorization: Bearer $token" `
  -H "Idempotency-Key: 0f7c9b1e-import-0001" `
  -F "shopeeShopId=38003654" `
  -F "file=@C:\tmp\Shopee_mass_upload_product_list.xlsx"
```

| # | Kịch bản | Kỳ vọng |
| - | -------- | ------- |
| 1 | File hợp lệ, lần đầu | `200`, `status=SUCCEEDED`, `stats.created = số item`, có `runId` |
| 2 | Import lại nguyên file | `200`, `stats.unchanged = itemsParsed`, không tạo bản ghi trùng |
| 3 | Sửa giá 1 item rồi import lại | `200`, `stats.updated = 1` |
| 4 | Bỏ 1 item khỏi file | `200`, `stats.notSeen = 1`; item trong DB mang trạng thái `NOT_SEEN` (không bị xoá) |
| 5 | 1 dòng giá sai (`abc`) | `200`, `status=PARTIAL`, `warningCount ≥ 1`; lỗi nằm ở `sync_errors` |
| 6 | Thiếu cột bắt buộc | `422 IMPORT_COLUMNS_MISSING`, không tạo `SyncRun` |
| 7 | File `.xls` 97-2003 hoặc file rỗng | `422 IMPORT_FILE_INVALID` |
| 8 | Thiếu `Idempotency-Key` | `400 IDEMPOTENCY_KEY_REQUIRED` |
| 9 | Gửi lại đúng key + đúng form | `200` + header `Idempotent-Replayed: true`, **không** tạo run thứ hai |
| 10 | Token `USER` thường | `403 FORBIDDEN` |
| 11 | Không gửi `shopeeShopId` và env `SHOPEE_SHOP_ID` trống | `409 SHOPEE_NOT_CONNECTED` |

Kiểm tra kết quả trong DB (Supabase SQL editor):

```sql
select id, provider, mode, status, stats, started_at, finished_at
  from "SyncRun" order by started_at desc limit 5;
select item_id, item_name, price, stock, item_status, last_seen_at
  from "ShopeeItem" order by last_seen_at desc limit 20;
```
