> ⚠️ **REVISION 2026-10-14 — mô hình bán hàng đã đổi sang Shopee.** Showroom không xử lý thanh toán; nút mua deep-link sang gian hàng Shopee; backend tập trung **đồng bộ dữ liệu mặt hàng với Shopee**. Các nội dung wallet/escrow/orders/payment trong tài liệu này thuộc mô hình cũ — thay thế bởi [SHOPEE_SHOWROOM_BACKEND.md](../../backend/SHOPEE_SHOWROOM_BACKEND.md).

# 11. Đặc tả API

## 11.1. Tổng quan

| Hạng mục | Giá trị |
| -------- | ------- |
| Kiểu API | REST/JSON, versioned |
| Base path | `/api/v1` |
| Auth | Bearer JWT (Supabase), verify qua JWKS |
| Content-Type | `application/json`; lỗi trả `application/problem+json` |
| Định dạng lỗi | RFC 7807 ProblemDetail + trường `code` ổn định |
| Tiền tệ | Chuỗi số nguyên đồng, ví dụ `"95000"` - không bao giờ là `number` |
| Thời gian | ISO-8601 UTC (`2026-10-14T03:00:00Z`); client tự đổi sang `Asia/Ho_Chi_Minh` để hiển thị |
| Phân trang | Cursor keyset: `?cursor=<id>&take=<1..100>`; response `{ "data": [...], "nextCursor": "..." }` |
| Idempotency | Header `Idempotency-Key` **bắt buộc** với mọi POST tạo giao dịch tiền/đơn |
| Correlation | Mọi response kèm `X-Request-Id`; client gửi kèm khi cần trace |

Trạng thái endpoint theo quy ước [README.md](../../README.md). Lưu ý: các endpoint
gắn nhãn 🟨 có **service đã code + test** (xem 06 mục 6.11) nhưng chưa có
controller HTTP - hợp đồng dưới đây là đặc tả để hiện thực.

## 11.2. Quy ước chung

### 11.2.1. Mức xác thực

| Mức | Ý nghĩa | Ví dụ endpoint |
| --- | ------- | -------------- |
| Public | Không cần token | `GET /products`, `GET /listings`, `POST /webhooks/...` |
| User | Bearer token hợp lệ | `/me`, `/orders`, `/wallet`, `/withdrawals` |
| Staff | `role ∈ {STAFF, ADMIN}` đọc từ DB | `/staff/*` |
| Admin | `role = ADMIN` | `/admin/*` |

Quy tắc: role **luôn** đọc từ `UserProfile.role` (FR-03); tài khoản `isBlocked`
bị từ chối mọi endpoint tiền với `403 ACCOUNT_BLOCKED` (FR-04).

### 11.2.2. Định dạng lỗi (RFC 7807)

```json
{
  "type": "https://tnc.vn/errors/insufficient-funds",
  "title": "Insufficient funds",
  "status": 409,
  "code": "INSUFFICIENT_FUNDS",
  "detail": "Số dư ví không đủ để thực hiện giao dịch.",
  "instance": "/api/v1/orders/9f1c.../pay-wallet",
  "requestId": "01JC9..."
}
```

- `code` là **hợp đồng ổn định** để frontend dịch thông điệp; `title`/`detail`
  chỉ mang tính hiển thị.
- Không bao giờ trả message nội bộ (chứa wallet id, số dư, số tài khoản) ra
  client - xem 06 mục 6.7.

### 11.2.3. Idempotency-Key

- Bắt buộc với: `POST /orders`, `POST /orders/{id}/pay-wallet`,
  `POST /wallet/topups`, `POST /withdrawals`, các POST staff thay đổi tiền.
- Sinh bởi client (uuid v4), dùng **một lần cho một ý định**; retry mạng dùng
  lại key cũ, lần bấm mới sinh key mới.
- Hành vi:
  - Same key + same payload ⇒ replay đúng response cũ (kèm header
    `Idempotent-Replayed: true`).
  - Same key + khác payload ⇒ `409 IDEMPOTENCY_CONFLICT`.
  - Lần gọi đầu còn đang xử lý ⇒ `409 IDEMPOTENCY_IN_PROGRESS` (client retry
    sau 1-2 s).
- Tầng ledger còn có unique `LedgerTransfer.idempotencyKey` riêng
  (`deposit:{gatewayRef}`, `order-payment:{orderId}`...) nên retry sâu nhất vẫn
  an toàn kể cả khi `IdempotencyRecord` bị dọn.

### 11.2.4. Phân trang, lọc, sắp xếp

- `take` mặc định 20, tối đa 100.
- Cursor = `id` của phần tử cuối; server trả `nextCursor: null` khi hết.
- Bộ lọc phổ biến: `status`, `type` (`RETAIL`/`SECONDHAND`), `categoryId`,
  `minPrice`/`maxPrice` (chuỗi đồng), `q` (tìm kiếm).
- Không dùng OFFSET cho sổ giao dịch/đơn hàng (tránh trùng/sót dòng khi có ghi
  mới - xem 06 mục về `getStatement`).

## 11.3. Health

| Method | Path | Auth | Trạng thái | Mô tả |
| ------ | ---- | ---- | ---------- | ----- |
| GET | `/health` | Public | ✅ (2026-10-14, `src/modules/health`) | Process sống; trả `{ "status": "ok", "version": "..." }` |
| GET | `/health/db` | Public (nội bộ) | ✅ (2026-10-14) | Ping database + migration head từ `_prisma_migrations` |

## 11.4. Danh tính

### 11.4.1. GET /me

Trả hồ sơ + role + ví tóm tắt của user đang đăng nhập.

- Auth: User. Trạng thái: ✅ (HTTP test bắt buộc).

```json
{
  "id": "3a5b...",
  "email": "an@example.com",
  "displayName": "An",
  "role": "USER",
  "isBlocked": false,
  "wallet": { "balance": "150000", "currency": "VND" }
}
```

Lỗi: `401 UNAUTHENTICATED` (thiếu/hết hạn token), `404 PROFILE_NOT_FOUND`
(hiếm - provisioning lỗi, cần điều tra).

## 11.5. Catalog (B2C + C2C)

| Method | Path | Auth | Trạng thái | Mô tả |
| ------ | ---- | ---- | ---------- | ----- |
| GET | `/products` | Public | ⬜ | Danh sách sản phẩm B2C + listing C2C đã duyệt |
| GET | `/products/{id}` | Public | ⬜ | Chi tiết sản phẩm/listing |
| GET | `/listings` | Public | ⬜ | Chỉ listing C2C đã duyệt (view chuyên cho chợ second-hand) |
| GET | `/categories` | Public | ⬜ | Cây danh mục |

### 11.5.1. GET /products

Query: `type`, `categoryId`, `q`, `minPrice`, `maxPrice`, `condition`
(`NEW`, `LIKE_NEW`, `USED`...), `cursor`, `take`.

```json
{
  "data": [
    {
      "id": "prod_...",
      "type": "SECONDHAND",
      "name": "Son MAC Chili (đã dùng 20%)",
      "price": "250000",
      "currency": "VND",
      "stock": 1,
      "condition": { "usedPercent": 20, "expiry": "2027-03" },
      "images": ["https://<ref>.supabase.co/storage/v1/object/public/listing-images/...jpg"],
      "seller": { "displayName": "Linh", "rating": 4.8 }
    }
  ],
  "nextCursor": "prod_..."
}
```

Quy tắc: chỉ trả sản phẩm đang bán và listing `APPROVED`; listing `SOLD` biến
khỏi kết quả (FR-17, FR-20); giá là chuỗi (05 mục 5.3).

### 11.5.2. GET /products/{id}

Trả chi tiết: mô tả, ảnh CDN, tồn kho khả dụng, thuộc tính C2C (% đã dùng, hạn
dùng còn lại, ảnh chứng minh), thông tin flash sale nếu đang trong khung giờ
(FR-06, FR-07). Lỗi: `404 NOT_FOUND` (không tồn tại hoặc chưa được duyệt - không
phân biệt với guest).

## 11.6. Đơn hàng

| Method | Path | Auth | Idempotency | Trạng thái | Mô tả |
| ------ | ---- | ---- | ----------- | ---------- | ----- |
| POST | `/orders` | User | Bắt buộc | ⬜ | Tạo đơn + giữ chỗ tồn kho |
| GET | `/orders` | User | - | ⬜ | Đơn của tôi (mua/bán), lọc `role` (buyer hoặc seller), `status` |
| GET | `/orders/{id}` | User (chủ đơn/staff) | - | ⬜ | Chi tiết + timeline |
| POST | `/orders/{id}/pay-wallet` | User (buyer) | Bắt buộc | ✅ (ledger service + HTTP 2026-10-14) | Trả bằng ví: buyer → ESCROW |
| POST | `/orders/{id}/cancel` | User (buyer) | ⬜ | ⬜ | Hủy khi `PENDING_PAYMENT`, trả tồn kho |
| POST | `/orders/{id}/confirm-received` | User (buyer) | ⬜ | ⬜ | `SHIPPED → DELIVERED` |
| POST | `/orders/{id}/dispute` | User (buyer) | ⬜ | ⬜ | Mở tranh chấp khi chưa release |

### 11.6.1. POST /orders

```json
{
  "items": [{ "productId": "prod_...", "quantity": 1 }],
  "shipping": { "recipientName": "An", "phone": "09xx", "address": "..." },
  "paymentMethod": "WALLET"
}
```

Xử lý: một transaction ngắn - guarded update tồn kho (`WHERE stock >= qty`),
tạo `Order` `PENDING_PAYMENT`, chốt `commissionAmount`, đặt hạn giữ chỗ
`APP_RESERVATION_MINUTES` (FR-10, FR-13).

Response `201`:

```json
{
  "id": "9f1c...",
  "code": "TNC-20261014-0001",
  "status": "PENDING_PAYMENT",
  "grossAmount": "250000",
  "commissionAmount": "12500",
  "expiresAt": "2026-10-14T03:10:00Z"
}
```

Lỗi: `409 OUT_OF_STOCK`, `400 VALIDATION_ERROR`, `409
IDEMPOTENCY_CONFLICT`.

### 11.6.2. POST /orders/{id}/pay-wallet

Không có body (hoặc `{}`). Xử lý một transaction duy nhất (FR-12, FR-23):
`buyer -gross`; `ESCROW +gross`; order → `PAID`; listing (nếu C2C) → `SOLD`.
Khoá ledger `order-payment:{orderId}`.

Response `200`:

```json
{
  "orderId": "9f1c...",
  "status": "PAID",
  "paidAt": "2026-10-14T03:02:11Z",
  "transferId": "5d2e...",
  "applied": true
}
```

`applied: false` khi là replay (đã thanh toán trước đó) - cùng status 200.

Lỗi: `409 INSUFFICIENT_FUNDS` (thiếu tiền), `409 INVALID_STATE_TRANSITION`
(đơn không còn `PENDING_PAYMENT`/hết hạn giữ chỗ), `404 NOT_FOUND`,
`403 FORBIDDEN` (không phải buyer của đơn).

### 11.6.3. GET /orders và GET /orders/{id}

- `GET /orders?role=buyer&status=PAID&cursor=&take=` - phân trang cursor.
- Chi tiết đơn trả: items, số tiền (gross, commission, seller nhận), timeline
  trạng thái (kèm audit hiển thị được), thông tin escrow
  (`escrowed: true/false`).
- Buyer/seller chỉ xem đơn của mình; staff xem tất cả (qua `/staff/orders`).

## 11.7. Ví và nạp tiền

| Method | Path | Auth | Idempotency | Trạng thái | Mô tả |
| ------ | ---- | ---- | ----------- | ---------- | ----- |
| GET | `/wallet` | User | - | ✅ (2026-10-14) | Số dư hiện tại |
| GET | `/wallet/statement` | User | - | ✅ (2026-10-14) | Sổ giao dịch, cursor keyset |
| POST | `/wallet/topups` | User | Bắt buộc | ⬜ | Tạo yêu cầu nạp → QR |
| GET | `/wallet/topups/{id}` | User | - | ⬜ | Trạng thái top-up (poll) |

### 11.7.1. GET /wallet

```json
{ "balance": "150000", "currency": "VND", "updatedAt": "2026-10-14T03:02:11Z" }
```

### 11.7.2. GET /wallet/statement

Query: `cursor`, `take` (mặc định 20, tối đa 100).

```json
{
  "data": [
    {
      "id": "entry_...",
      "kind": "ORDER_PAYMENT",
      "description": "Thanh toán đơn TNC-20261014-0001",
      "amount": "-250000",
      "balanceAfter": "150000",
      "orderId": "9f1c...",
      "createdAt": "2026-10-14T03:02:11Z"
    }
  ],
  "nextCursor": "entry_..."
}
```

### 11.7.3. POST /wallet/topups

```json
{ "amount": "100000", "provider": "PAYOS" }
```

Response `201`:

```json
{
  "id": "topup_...",
  "status": "PENDING",
  "amount": "100000",
  "qrPayload": "...",
  "bankInfo": { "bank": "VCB", "accountName": "TNC", "content": "TNC-TOPUP-9f1c" },
  "expiresAt": "2026-10-14T03:20:00Z"
}
```

Lỗi: `400 VALIDATION_ERROR` (số tiền ngoài hạn mức - hạn mức cần chốt),
`403 ACCOUNT_BLOCKED`.
## 11.8. Tài khoản nhận tiền (PayoutMethod)

| Method | Path | Auth | Trạng thái | Mô tả |
| ------ | ---- | ---- | ---------- | ----- |
| GET | `/payout-methods` | User | ⬜ | Danh sách tài khoản nhận tiền (số che một phần) |
| POST | `/payout-methods` | User | ⬜ | Thêm tài khoản nhận tiền |
| DELETE | `/payout-methods/{id}` | User | ⬜ | Xoá mềm (không xoá nếu đang gắn lệnh rút chưa xong) |

```json
{
  "bankCode": "VCB",
  "accountNumber": "0123456789",
  "accountHolder": "NGUYEN VAN AN"
}
```

Response:

```json
{ "id": "pm_...", "bankCode": "VCB", "accountNumberMasked": "****6789", "accountHolder": "NGUYEN VAN AN", "isVerified": false }
```

Quy tắc: số tài khoản đầy đủ chỉ tồn tại một lần lúc tạo; mọi response/log chỉ
dùng bản che (FR-34, FR-44).

## 11.9. Rút tiền (người dùng)

| Method | Path | Auth | Idempotency | Trạng thái | Mô tả |
| ------ | ---- | ---- | ----------- | ---------- | ----- |
| POST | `/withdrawals` | User | Bắt buộc | 🟨 (phần approve/settle ✅ service) | Tạo lệnh rút `REQUESTED` |
| GET | `/withdrawals` | User | - | ⬜ | Danh sách lệnh của tôi |
| GET | `/withdrawals/{id}` | User | - | ⬜ | Chi tiết + lý do nếu bị từ chối/failed |

### 11.9.1. POST /withdrawals

```json
{ "payoutMethodId": "pm_...", "amount": "200000" }
```

Response `201`:

```json
{
  "id": "wd_...",
  "status": "REQUESTED",
  "amount": "200000",
  "payoutMethod": { "accountNumberMasked": "****6789", "bankCode": "VCB" },
  "createdAt": "2026-10-14T04:00:00Z"
}
```

Quy tắc: tạo lệnh **không** debit (debit chỉ xảy ra ở bước approve - FR-36);
kiểm tra số dư khả dụng và hạn mức (hạn mức cần chốt).

Lỗi: `409 INSUFFICIENT_FUNDS`, `400 VALIDATION_ERROR`, `404 NOT_FOUND`
(payout method không thuộc user).

## 11.10. Listing second-hand (người bán)

| Method | Path | Auth | Idempotency | Trạng thái | Mô tả |
| ------ | ---- | ---- | ----------- | ---------- | ----- |
| POST | `/listings` | User | Bắt buộc | ⬜ | Tạo tin → `PENDING_REVIEW` |
| GET | `/listings/mine` | User | - | ⬜ | Tin của tôi, lọc `status` |
| GET | `/listings/{id}` | Public/owner | - | ⬜ | Chi tiết tin (chưa duyệt chỉ owner/staff xem) |
| PATCH | `/listings/{id}` | User (owner) | - | ⬜ | Sửa tin (bị từ chối/hidden); sửa nội dung đã duyệt ⇒ duyệt lại |
| POST | `/listings/images/upload-url` | User | - | ⬜ | Xin signed URL upload ảnh |

### 11.10.1. POST /listings

```json
{
  "title": "Son MAC Chili 95%",
  "categoryId": "cat_lipstick",
  "price": "250000",
  "usedPercent": 20,
  "expiryNote": "03/2027",
  "description": "Mua T3/2026 tại TNC, dùng 2-3 lần...",
  "images": ["listings/3a5b/01.jpg", "listings/3a5b/02.jpg", "listings/3a5b/receipt.jpg"]
}
```

Response `201`: `{ "id": "ls_...", "status": "PENDING_REVIEW", "createdAt": "..." }`

Quy tắc:

- Mọi tin mới ở `PENDING_REVIEW`; không hiển thị công khai (FR-17).
- `images` là các path đã upload qua signed URL do backend cấp; backend kiểm tra
  path thuộc đúng user (FR-09).
- Trạng thái: `PENDING_REVIEW → APPROVED | REJECTED | HIDDEN`; `APPROVED → SOLD`
  khi có đơn thanh toán; `REJECTED → (sửa) → PENDING_REVIEW` (FR-18, FR-19).

### 11.10.2. POST /listings/images/upload-url

```json
{ "contentType": "image/jpeg", "sizeBytes": 2048000 }
```

Response:

```json
{
  "uploadUrl": "https://<ref>.supabase.co/storage/v1/object/upload/sign/listing-images/...",
  "path": "listings/3a5b/8f2c.jpg",
  "expiresAt": "2026-10-14T04:10:00Z"
}
```

Lỗi: `400 FILE_TOO_LARGE` (> 5 MB), `400 UNSUPPORTED_MEDIA_TYPE`, `400
TOO_MANY_IMAGES` (> 10 ảnh/listing - mặc định tạm).
## 11.11. Khu vực Staff

Tất cả endpoint dưới đây yêu cầu `role ∈ {STAFF, ADMIN}`; mọi hành động thay
đổi trạng thái ghi `AuditLog` kèm actor + lý do (FR-42).

### 11.11.1. Duyệt tin đăng

| Method | Path | Idempotency | Trạng thái | Mô tả |
| ------ | ---- | ----------- | ---------- | ----- |
| GET | `/staff/listings` | - | ⬜ | Hàng chờ duyệt (`?status=PENDING_REVIEW`) |
| POST | `/staff/listings/{id}/approve` | - | ⬜ | Duyệt → `APPROVED` |
| POST | `/staff/listings/{id}/reject` | - | ⬜ | Từ chối + `reason` (bắt buộc) |
| POST | `/staff/listings/{id}/hide` | - | ⬜ | Ẩn tin đã duyệt + `reason` |

```json
// POST /staff/listings/{id}/reject
{ "reason": "Ảnh chứng minh mua hàng không khớp với sản phẩm" }
```

Lỗi: `409 INVALID_STATE_TRANSITION` (duyệt tin không còn chờ duyệt),
`400 VALIDATION_ERROR` (thiếu reason).

### 11.11.2. Đơn hàng

| Method | Path | Idempotency | Trạng thái | Mô tả |
| ------ | ---- | ----------- | ---------- | ----- |
| GET | `/staff/orders` | - | ⬜ | Lọc theo `status`, `overdue`, `q` |
| PATCH | `/staff/orders/{id}` | - | ⬜ | Cập nhật giao vận: `READY_TO_SHIP`/`SHIPPED`/`DELIVERED` + ghi chú |
| POST | `/staff/orders/{id}/release` | Bắt buộc | 🟨 (service ✅) | Release escrow cho seller |
| POST | `/staff/orders/{id}/refund` | Bắt buộc | 🟨 (service ✅) | Hoàn tiền cho buyer + `reason` |

```json
// PATCH /staff/orders/{id}
{ "status": "SHIPPED", "trackingCode": "GHN123456", "note": "Giao dự kiến 16/10" }

// POST /staff/orders/{id}/refund
{ "reason": "Buyer cung cấp bằng chứng hàng sai mô tả" }
```

Quy tắc: release chỉ hợp lệ từ `DELIVERED`; refund chỉ khi tiền còn escrow
(`PAID..DISPUTED`) - xem UC-08; cả hai dùng khoá idempotency
`order-release:{id}` / `order-refund:{id}`.

Lỗi: `409 INVALID_STATE_TRANSITION`, `409 ESCROW_EMPTY`, `400 VALIDATION_ERROR`.

### 11.11.3. Lệnh rút tiền

| Method | Path | Idempotency | Trạng thái | Mô tả |
| ------ | ---- | ----------- | ---------- | ----- |
| GET | `/staff/withdrawals` | - | ⬜ | Hàng chờ: `REQUESTED`, `APPROVED` (đang chờ ngân hàng) |
| POST | `/staff/withdrawals/{id}/approve` | Bắt buộc | 🟨 (service ✅) | Duyệt: user debit → `WITHDRAWAL_CLEARING` |
| POST | `/staff/withdrawals/{id}/reject` | - | ⬜ | Từ chối trước debit + `reason` |
| POST | `/staff/withdrawals/{id}/settle` | Bắt buộc | 🟨 (service ✅) | Ngân hàng xong: clearing → gateway |
| POST | `/staff/withdrawals/{id}/fail` | Bắt buộc | 🟨 (service ✅) | Thất bại: transfer đảo hoàn tiền + `reason` |

```json
// POST /staff/withdrawals/{id}/fail
{ "reason": "Sai số tài khoản người nhận, ngân hàng hoàn lệnh" }
```

Lỗi: `409 INSUFFICIENT_FUNDS` (số dư đổi từ lúc tạo), `409
INVALID_STATE_TRANSITION` (sai trạng thái/ví dụ approve hai lần),
`403 FORBIDDEN`.

## 11.12. Điều chỉnh ngoại lệ (Admin)

| Method | Path | Idempotency | Trạng thái | Mô tả |
| ------ | ---- | ----------- | ---------- | ----- |
| POST | `/admin/adjustments` | Bắt buộc | ⬜ | Tạo transfer `ADJUSTMENT` (có lý do bắt buộc, ghi audit) |
| GET | `/admin/reports/revenue` | - | ⬜ | Báo cáo doanh thu/hoa hồng theo kỳ (FR-45) |

```json
// POST /admin/adjustments
{
  "legs": [
    { "walletIdOrCode": "PLATFORM_REVENUE", "amount": "-50000" },
    { "walletIdOrCode": "user:3a5b...", "amount": "50000" }
  ],
  "reason": "Hoàn phí sự cố giao hàng (ticket #123)",
  "reference": "ticket-123"
}
```

Quy tắc: ADJUSTMENT không bao giờ sửa dòng cũ; tổng leg = 0; chỉ ADMIN; audit
bắt buộc (FR-41).

## 11.13. Webhook thanh toán

| Method | Path | Auth | Trạng thái | Mô tả |
| ------ | ---- | ---- | ---------- | ----- |
| POST | `/webhooks/payments/{provider}` | Chữ ký PSP | 🟨 (service `confirmDeposit` ✅; verify ⬜) | Nhận xác nhận nạp tiền từ PayOS/VietQR/Stripe |

Yêu cầu bắt buộc khi hiện thực (06 mục 6.6):

1. Đọc **raw body** trước khi parse JSON.
2. Verify chữ ký theo chuẩn từng provider (PayOS: HMAC-SHA256 + checksum key;
   Stripe: `Stripe-Signature`).
3. Sai chữ ký ⇒ `401`, ghi log an toàn (không log payload đầy đủ).
4. Chỉ đọc `amount`/`gatewayRef`/`userId` từ payload **đã verify**.
5. Gọi `confirmDeposit()` idempotent theo `deposit:{gatewayRef}`.
6. Trả `2xx` nhanh (≤ 2 s); retry của PSP là replay an toàn.

Response:

```json
{ "received": true, "applied": true }
```

`applied: false` khi là replay (không cộng tiền lần hai).

## 11.14. Tổng hợp trạng thái endpoint

| Nhóm | Endpoint | Trạng thái |
| ---- | -------- | ---------- |
| Health | `GET /health`, `GET /health/db` | ✅ |
| Danh tính | `GET /me` | ✅ |
| Catalog | `GET /products`, `/products/{id}`, `/listings`, `/categories` | ⬜ |
| Đơn hàng | `POST /orders`, `GET /orders`, `/orders/{id}`, `/cancel`, `/confirm-received`, `/dispute` | ⬜ |
| Đơn hàng | `POST /orders/{id}/pay-wallet` | ✅ |
| Ví | `GET /wallet`, `GET /wallet/statement` | ✅ |
| Ví | `POST /wallet/topups`, `GET /wallet/topups/{id}` | ⬜ |
| Rút tiền | `POST /withdrawals`, `GET /withdrawals`, `/withdrawals/{id}` | 🟨 (tạo lệnh chưa nối HTTP; luồng tiền đã có) |
| Payout | `/payout-methods` (GET/POST/DELETE) | ⬜ |
| Listing | `POST /listings`, `/listings/mine`, `PATCH /listings/{id}`, `/images/upload-url` | ⬜ |
| Staff - duyệt tin | `/staff/listings`, `/approve`, `/reject`, `/hide` | ⬜ |
| Staff - đơn | `/staff/orders`, `PATCH`, `/release`, `/refund` | 🟨 (release/refund) |
| Staff - rút tiền | `/staff/withdrawals`, `/approve`, `/reject`, `/settle`, `/fail` | 🟨 (approve/settle/fail) |
| Admin | `/admin/adjustments`, `/admin/reports/revenue` | ⬜ |
| Webhook | `POST /webhooks/payments/{provider}` | 🟨 (confirmDeposit ✅) |
| **Sync Shopee** | `POST /admin/shopee/import` (multipart, STAFF/ADMIN, Idempotency-Key) | ✅ S2 |

## 11.15. Danh mục mã lỗi (error catalog)

| HTTP | code | Ý nghĩa | Nguồn |
| ---- | ---- | ------- | ----- |
| 400 | `VALIDATION_ERROR` | Payload sai định dạng/thiếu trường | DTO validation |
| 400 | `IDEMPOTENCY_KEY_REQUIRED` | POST tiền thiếu header `Idempotency-Key` | Idempotency interceptor |
| 400 | `FILE_TOO_LARGE` / `UNSUPPORTED_MEDIA_TYPE` / `TOO_MANY_IMAGES` | Upload ảnh vi phạm giới hạn | Module listing |
| 401 | `UNAUTHENTICATED` | Thiếu token / chữ ký không hợp lệ / hết hạn | Auth guard |
| 401 | `WEBHOOK_SIGNATURE_INVALID` | Webhook sai chữ ký | Webhook guard |
| 403 | `FORBIDDEN` | Thiếu quyền (không phải chủ đơn, không phải staff) | Authz |
| 403 | `ACCOUNT_BLOCKED` | Tài khoản bị khoá, không được thao tác tiền | Authz (FR-04) |
| 404 | `NOT_FOUND` | Không tồn tại hoặc không được phép nhìn thấy | Service |
| 404 | `PROFILE_NOT_FOUND` | Token hợp lệ nhưng chưa có `UserProfile` (provisioning lỗi) | Auth guard |
| 405 | `METHOD_NOT_ALLOWED` | Sai phương thức HTTP cho endpoint | Framework |
| 409 | `INSUFFICIENT_FUNDS` | Ví không đủ tiền | `InsufficientFundsError` |
| 409 | `INVALID_STATE_TRANSITION` | Sai trạng thái đơn/lệnh rút/listing | `InvalidStateTransitionError` |
| 409 | `ESCROW_EMPTY` | Đơn không còn tiền trong escrow cho đơn đó | `EscrowEmptyError` |
| 409 | `ALREADY_REVERSED` | Cố đảo một transfer đã bị đảo | `AlreadyReversedError` |
| 409 | `OUT_OF_STOCK` | Tồn kho không đủ tại thời điểm giữ chỗ | Module order |
| 409 | `CONFLICT` | Xung đột dữ liệu chung (unique/FK) chưa có code riêng | Prisma → filter |
| 409 | `IDEMPOTENCY_CONFLICT` | Cùng key, khác payload/endpoint/user | Idempotency interceptor |
| 409 | `IDEMPOTENCY_IN_PROGRESS` | Request cùng key đang xử lý | Idempotency interceptor |
| 409 | `SYNC_ALREADY_RUNNING` | Đang có sync run chạy | Module sync (S2) |
| 409 | `SHOPEE_NOT_CONNECTED` | Chưa cấu hình gian hàng/credential Shopee | Module sync (S2) |
| 409 | `ITEM_NOT_LINKED` | Product chưa gắn item Shopee | Module curation (S3) |
| 410 | `PRODUCT_UNLISTED` | Sản phẩm đã ẩn/ngừng bán theo sync | Module catalog (S3) |
| 422 | `IMPORT_FILE_INVALID` | File import sai định dạng/không đọc được | Module sync (S2) |
| 422 | `IMPORT_COLUMNS_MISSING` | File import thiếu cột bắt buộc | Module sync (S2) |
| 429 | `RATE_LIMITED` | Vượt giới hạn tần suất | Rate limiter (planned) |
| 500 | `INTERNAL_ERROR` | Lỗi không lường trước (đã che chi tiết) | Global filter |
| 500 | `WALLET_NOT_FOUND` / `SYSTEM_WALLET_MISSING` | Ví chưa provisioning / thiếu ví hệ thống | Ledger (lỗi vận hành) |
| 500 | `LEDGER_INTEGRITY_VIOLATION` | Bất biến DB bị vi phạm - báo động | DB trigger |
| 503 | `SERVICE_UNAVAILABLE` | DB ping lỗi hoặc không verify được token (JWKS down) | Health/JWKS |

Ánh xạ này là hợp đồng của `ProblemDetailFilter` (✅ `src/common/http/error-catalog.ts`); cập nhật đồng thời với 06
mục 6.7 khi thêm domain error mới.

## 11.16. Versioning và thay đổi phá vỡ

- Thay đổi **tương thích** (thêm field, thêm endpoint, thêm enum value mới mà
  client cũ chưa biết) ⇒ giữ `/api/v1`.
- Thay đổi **phá vỡ** (đổi kiểu trường, xoá field, đổi ngữ nghĩa `code`) ⇒ mở
  `/api/v2`, giữ v1 chạy song song tối thiểu 1 chu kỳ phát hành.
- Mọi endpoint tiền: contract thay đổi phải kèm test + cập nhật chương này trong
  cùng PR (NFR-33).


