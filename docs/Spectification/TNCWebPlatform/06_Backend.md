> ⚠️ **REVISION 2026-10-14 — mô hình bán hàng đã đổi sang Shopee.** Showroom không xử lý thanh toán; nút mua deep-link sang gian hàng Shopee; backend tập trung **đồng bộ dữ liệu mặt hàng với Shopee**. Các nội dung wallet/escrow/orders/payment trong tài liệu này thuộc mô hình cũ — thay thế bởi [SHOPEE_SHOWROOM_BACKEND.md](../../backend/SHOPEE_SHOWROOM_BACKEND.md).

# 06. Backend (NestJS)

## 6.1. Tổng quan

Backend là **NestJS modular monolith** - đơn vị triển khai duy nhất - đóng vai
trò "marketplace core + banking vault":

- Nghiệp vụ thị trường: catalog, listing + duyệt, đơn hàng, checkout.
- Ngân hàng nội bộ: ví, ledger, escrow, hoa hồng, lệnh rút.
- Tích hợp: webhook PSP (verify chữ ký), job định kỳ, audit trail.

Kết nối database qua Prisma (`DATABASE_URL` - transaction pooler). Xem
[04_Infrastructure.md](04_Infrastructure.md) mục 4.2.1.

Trạng thái hiện tại (2026-10-14):

| Khối | Trạng thái |
| ---- | ---------- |
| Ledger core + banking flows + schema/guards | ✅ đã code, đã test (51 test) |
| HTTP API, auth guard, ProblemDetail filter | ⬜ |
| Webhook PSP, scheduled jobs | ⬜ |
| Module catalog/listing/order đầy đủ, audit aspect | ⬜ |

## 6.2. Cấu trúc source

### Hiện có

| File | Vai trò |
| ---- | ------- |
| `src/prisma/prisma.service.ts` | PrismaClient duy nhất, lifecycle connect/disconnect, nhận options (test silence log) |
| `src/prisma/prisma.module.ts` | Module `@Global` export PrismaService |
| `src/common/money.ts` | Kiểu `Money` (= Prisma.Decimal), `splitCommission`, `assertWholeDong`, serialize tiền |
| `src/modules/banking/ledger.service.ts` | `post()` / `reverse()` / tra cứu idempotency - thành phần **duy nhất** được ghi vào Wallet/LedgerTransfer/LedgerEntry |
| `src/modules/banking/banking.service.ts` | Luồng nghiệp vụ: deposit, pay, release, refund, withdrawal approve/settle/fail, đọc số dư/statement, đối soát |
| `src/modules/banking/ledger.errors.ts` | Domain errors (`LedgerError` subclasses) với `code` ổn định, không phụ thuộc HTTP |
| `src/config/configuration.ts` | Map env → namespace `app.*` (commission, version, CORS, TTL idempotency) và `auth.*` |
| `src/main.ts`, `src/app.module.ts`, `src/app.setup.ts` | Bootstrap HTTP: global prefix `api/v1`, CORS từ `CORS_ORIGINS`, `X-Request-Id`, ValidationPipe toàn cục (whitelist + forbid unknown) |
| `src/common/errors/app-error.ts` | `AppError` mang `code` ổn định - loại lỗi controller/guard được phép throw |
| `src/common/http/error-catalog.ts` + `problem-detail.filter.ts` | `@Catch()` filter → RFC 7807 (`application/problem+json`) + `code`; message nội bộ chỉ vào log |
| `src/common/auth/*` + `src/modules/auth/*` | `AuthGuard` toàn cục (mặc định chặn, `@Public()` mới mở); verify JWT Supabase qua JWKS ES256/RS256 hoặc HS256 secret; role/`isBlocked` đọc từ DB mỗi request; `@Roles()`, `@RequireActiveAccount()`, `@CurrentUser()` |
| `src/modules/idempotency/*` | Tầng API idempotency: `Idempotency-Key` + `IdempotencyRecord`, replay response kèm `Idempotent-Replayed: true` |
| `src/modules/health/*` | `GET /health`, `GET /health/db` (ping + migration head) |
| `src/modules/identity/*` | `GET /me` - hồ sơ + role + ví tóm tắt |
| `src/modules/wallet/*` | `GET /wallet`, `GET /wallet/statement` (nối `getBalance`/`getStatement`, map DTO tiền dạng chuỗi) |
| `src/modules/orders/*` | `POST /orders/{id}/pay-wallet` (ownership 403/404 trước, nối `payForOrder`) |

### Kế hoạch (⬜)

| Module | Trách nhiệm |
| ------ | ----------- |
| `catalog` | Category, Product B2C (tồn kho lô), tìm kiếm/lọc |
| `listing` | Tin đăng C2C: tạo/sửa, upload ảnh, submit duyệt; staff approve/reject + audit |
| `order` | Giỏ/checkout, giữ chỗ tồn kho, vòng đời đơn, cancel |
| `payment` | Top-up intent (QR) + webhook verify chữ ký (tầng `IdempotencyRecord` ✅ đã có, áp cho endpoint khi viết) |
| `audit` | `@Auditable` + aspect ghi `AuditLog` cùng transaction |
| `jobs` | Auto-release escrow, hết hạn giữ chỗ, đối soát drift định kỳ |

## 6.3. Ví hệ thống và mô hình ledger

### 6.3.1. Các ví

| Ví | Kind | Ý nghĩa | Cho phép âm? |
| -- | ---- | ------- | ------------ |
| Ví người dùng | `USER` | Số dư khả dụng của buyer/seller | ❌ (CHECK constraint) |
| `ESCROW` | `ESCROW` | Tiền đã thu của người mua, chưa trả người bán | ❌ |
| `PLATFORM_REVENUE` | `PLATFORM_REVENUE` | Hoa hồng nền tảng | (thường dương) |
| `GATEWAY_CLEARING` | `GATEWAY_CLEARING` | Đối chiếu với PSP/ngân hàng; âm đúng bằng tổng tiền đã nạp vào | ✅ (được phép âm) |
| `WITHDRAWAL_CLEARING` | `WITHDRAWAL_CLEARING` | Tiền đang trên đường ra ngân hàng | ✅ (được phép âm) |

### 6.3.2. Transfer và leg

Mọi dòng tiền là một `LedgerTransfer` gồm ≥ 2 `LedgerEntry` có dấu, tổng = 0:

```text
Nạp tiền:        GATEWAY_CLEARING -a   user +a
Thanh toán:      buyer -g              ESCROW +g
Release C2C:     ESCROW -g             seller +(g-c)   PLATFORM_REVENUE +c
Release B2C:     ESCROW -g             PLATFORM_REVENUE +g     (TNC là người bán)
Hoàn tiền:       ESCROW -g             buyer +g
Duyệt rút:       user -a               WITHDRAWAL_CLEARING +a
Settle rút:      WITHDRAWAL_CLEARING -a  GATEWAY_CLEARING +a
Sai sót:         transfer đảo = ảnh gương âm của từng leg gốc
```

### 6.3.3. Guarded UPDATE - trái tim của tính đúng đắn

Mỗi leg được áp bằng **một câu UPDATE duy nhất** do Postgres kiểm tra và ghi
trong cùng một statement:

```sql
UPDATE "Wallet"
   SET balance = balance + :delta, version = version + 1, "updatedAt" = now()
 WHERE id = :id
   AND (kind <> 'USER' OR balance + :delta >= 0)
RETURNING id, balance
```

Vì check và ghi là cùng một statement, hai giao dịch đồng thời không thể cùng
"nhìn thấy đủ tiền". 0 dòng bị ảnh hưởng = thiếu tiền hoặc không có ví, và
transaction rollback toàn bộ. Thứ tự leg được sắp xếp theo walletId để tránh
deadlock khi hai transfer chạm cùng cặp ví.

### 6.3.4. Hoa hồng

- Chốt tại checkout và lưu vào `Order.commissionAmount` (không tính lại khi
  release - đổi tỷ lệ không ảnh hưởng đơn cũ).
- Mặc định `500` bps = 5.00%, cấu hình `APP_COMMISSION_BPS`.
- Chỉ làm tròn hoa hồng (HALF_UP, 0 chữ số thập phân); seller nhận phần còn lại
  nên `commission + seller === gross` theo cấu trúc (đã test cho mọi mức phí).

## 6.4. Escrow - quy tắc nghiệp vụ

| Quy tắc | Thực thi |
| ------- | -------- |
| Release chỉ khi đơn `DELIVERED` | Guarded UPDATE `WHERE status = DELIVERED` - trạng thái khác ⇒ 0 dòng ⇒ lỗi |
| Refund chỉ khi tiền còn trong escrow | Trạng thái cho phép `PAID..DISPUTED`; ngoài ra guarded UPDATE 0 dòng |
| Một đơn không được rút escrow của đơn khác | `assertEscrowHolds()`: đối chiếu riêng các leg của **chính đơn đó** (sum theo `orderId`), không dùng số dư tổng của ví escrow dùng chung |
| Không double-release / double-refund | Idempotency key `order-release:{id}` / `order-refund:{id}` |
| Sau release không thể hoàn tiền tự động | Đơn `COMPLETED` ⇒ refund bị từ chối (`INVALID_STATE_TRANSITION`); hoàn tiền ngoại lệ phải là ADJUSTMENT có audit |

## 6.5. Idempotency

Hai tầng, theo mức độ "có tiền hay không":

1. **Tầng ledger (✅)** - `LedgerTransfer.idempotencyKey` unique. Quy ước khoá
   theo sự kiện nghiệp vụ, ví dụ:
   `deposit:{gatewayRef}`, `order-payment:{orderId}`, `order-release:{orderId}`,
   `order-refund:{orderId}`, `withdrawal-approve:{id}`, `withdrawal-settle:{id}`.
   `BankingService.once()` xử lý 3 tình huống: replay tuần tự (trả kết quả cũ,
   `applied: false`), thua race (`P2002` hoặc guarded update 0 dòng ⇒ tra lại và
   trả replay), thực thi mới.
2. **Tầng API (✅ `src/modules/idempotency/`)** - header `Idempotency-Key` +
   bảng `IdempotencyRecord`, bật cho từng route bằng `@Idempotent()`:
   fingerprint = method + route + path params + body (SHA-256); record giữ
   response đã thành công và replay kèm `Idempotent-Replayed: true`; cùng key
   nhưng khác intent ⇒ `409 IDEMPOTENCY_CONFLICT`; request thứ hai đến khi cái
   đầu đang chạy ⇒ `409 IDEMPOTENCY_IN_PROGRESS`. Ghi chú thiết kế: record bị
   **xoá khi request thất bại**, nên client được phép retry cùng key sau khi
   sửa nguyên nhân; an toàn tiền vẫn do tầng ledger quyết định. TTL mặc định 24
   giờ (`IDEMPOTENCY_TTL_HOURS`).

Hệ quả thực tế đã được test: webhook nạp tiền gửi 3 lần (tuần tự và đồng
thời) chỉ cộng tiền một lần; double-click thanh toán 5 lần chỉ tạo một
transaction.

## 6.6. Webhook PSP (⬜ thiết kế)

Trình tự bắt buộc khi nhận webhook (`POST /api/v1/webhooks/payments/:provider`):

1. Đọc **raw body** (không parse trước khi verify).
2. Verify chữ ký theo chuẩn của provider (PayOS: HMAC-SHA256 + checksum key;
   Stripe: `Stripe-Signature`; bank polling: shared secret/IP allowlist).
3. Verify fail ⇒ trả 401, ghi log an toàn (không log payload đầy đủ).
4. Đọc `amount`, `gatewayRef`, `userId` **từ payload đã verify của PSP** -
   không bao giờ tin số tiền từ client.
5. Gọi `BankingService.confirmDeposit()` (idempotent theo `gatewayRef`).
6. Trả 2xx nhanh; retry của PSP chỉ là replay.

## 6.7. Error taxonomy (domain → HTTP, ✅ ProblemDetailFilter)

| Code | Nguồn | Ý nghĩa | HTTP dự kiến |
| ---- | ----- | ------- | ------------ |
| `INSUFFICIENT_FUNDS` | `InsufficientFundsError` | Ví không đủ tiền | 409 |
| `WALLET_NOT_FOUND` / `SYSTEM_WALLET_MISSING` | Ledger | Ví chưa provisioning / thiếu ví hệ thống | 500 (lỗi vận hành) |
| `INVALID_STATE_TRANSITION` | Banking | Sai trạng thái đơn/lệnh rút | 409 |
| `ESCROW_EMPTY` | Banking | Đơn không có tiền trong escrow | 409 |
| `UNBALANCED_TRANSFER` / `DUPLICATE_LEG` | Ledger.validate | Bug lập trình - chặn trước khi ghi | 500 |
| `ALREADY_REVERSED` | Ledger | Cố đảo một transfer đã đảo | 409 |
| `LEDGER_INTEGRITY_VIOLATION` | DB trigger | Bất biến DB bị vi phạm - báo động | 500 + alert |
| `IDEMPOTENCY_KEY_REQUIRED` | Interceptor | POST tiền thiếu header | 400 |
| `IDEMPOTENCY_CONFLICT` / `IDEMPOTENCY_IN_PROGRESS` | Interceptor | Cùng key khác intent / đang xử lý | 409 |
| `PROFILE_NOT_FOUND` | AuthGuard | Token hợp lệ nhưng thiếu `UserProfile` | 404 |
| `ACCOUNT_BLOCKED` | AccessGuard | Tài khoản `isBlocked` gọi endpoint tiền | 403 |

Nguyên tắc: `message` của lỗi chỉ dành cho log server, **không** trả về client
(một số message chứa wallet id/số tiền); response chỉ có `code` ổn định +
mô tả chung.

## 6.8. Audit (⬜ wiring)

- Mọi thay đổi trạng thái nghiệp vụ (duyệt/từ chối listing, chuyển trạng thái
  đơn, duyệt/settle/fail lệnh rút, adjust) ghi `AuditLog` **trong cùng
  transaction** với thay đổi.
- Bản ghi gồm: ai (actor + role), khi nào (UTC), cái gì (entity + id + action),
  chuyển trạng thái (old → new), lý do, metadata JSON, IP/user agent.
- Không log secret/payload thanh toán đầy đủ.

## 6.9. Scheduled jobs (⬜)

| Job | Chu kỳ | Việc làm |
| --- | ------ | -------- |
| Auto-release escrow | mỗi giờ | Đơn `DELIVERED` quá `APP_AUTO_RELEASE_DAYS` (đề xuất 3 ngày) → `releaseOrder()` với actor = system |
| Hết hạn giữ chỗ | mỗi phút | Đơn `PENDING_PAYMENT` quá `APP_RESERVATION_MINUTES` → hủy, trả tồn kho, audit |
| Đối soát drift | mỗi giờ | `WalletReconciliation` drift ≠ 0 ⇒ alert (không tự sửa) |
| Nhắc xử lý | hằng ngày | Listing chờ duyệt quá N ngày, lệnh rút chờ duyệt quá N ngày |

Job chạy trong cùng process NestJS (long-running), dùng advisory lock để không
chạy trùng khi scale ngang.

## 6.10. Cấu hình

| Key | Mặc định | Ghi chú |
| --- | -------- | ------- |
| `app.commissionBps` | `500` | Map từ `APP_COMMISSION_BPS` |
| `app.version` | `0.0.0` | Map từ `APP_VERSION`; trả trong `GET /health` |
| `app.corsOrigins` | `http://localhost:3000` | Map từ `CORS_ORIGINS` (danh sách phẩy); `*` = cho phép mọi origin |
| `app.idempotencyTtlHours` | `24` | Map từ `IDEMPOTENCY_TTL_HOURS` |
| `auth.supabaseUrl` | - | Map từ `SUPABASE_URL`; suy ra JWKS URL và issuer |
| `auth.jwtSecret` | - | Map từ `SUPABASE_JWT_SECRET` (chỉ cần cho project HS256 legacy) |
| `auth.jwksUrl` / `auth.issuer` / `auth.audience` | suy ra / suy ra / `authenticated` | Override khi cần (test, custom domain) |
| `auth.clockToleranceSeconds` / `auth.jwksCacheTtlSeconds` | `30` / `300` | Leeway clock; TTL cache JWKS (unknown `kid` ép refresh) |
| `app.reservationMinutes` | `10` | Mặc định tạm - cần chốt (⬜ job tương ứng) |
| `app.autoReleaseDays` | `3` | Đề xuất - cần chốt (⬜ job tương ứng) |

## 6.11. Kiểm thử (bằng chứng chạy thật)

```bash
npm test                 # 17 unit + 74 e2e = 91 test, tất cả pass (2026-10-14)
npm run test:unit        # chỉ logic thuần (money/commission)
npm run test:e2e         # integration + HTTP e2e trên PostgreSQL thật (harness tự dựng)
npm run typecheck        # tsc --noEmit
npm run build            # tsc -p tsconfig.build.json → dist/
npm start                # nest start (hoặc: node dist/main.js) - đã smoke test thật
```

| Bộ test | Chứng minh điều gì |
| ------- | ------------------ |
| `src/common/money.spec.ts` (17) | Làm tròn hoa hồng đúng; `commission + seller === gross` với mọi mức phí; whole-đồng; biên 0%/100% |
| `test/ledger-guards.spec.ts` | DB triggers/constraints: transfer lệch/1 leg/leg trùng/0 đồng/phần lẻ đều không commit được; sổ append-only; ví USER/ESCROW không âm; RLS + revoke; lỗi validation của LedgerService; reverse đúng và chặn đảo lần hai |
| `test/banking.spec.ts` | payForOrder đồng thời (5 request ⇒ 1 thắng); 2 đơn đồng thời với tiền chỉ đủ 1 ⇒ 1 thắng + 1 `INSUFFICIENT_FUNDS`, không âm ví; replay thanh toán; webhook nạp replay ×3 + race ×3 ⇒ cộng một lần; release/refund đúng trạng thái; escrow isolation; withdrawal approve/settle/fail; statement keyset; drift = 0 sau toàn bộ luồng |

| `test/http/health.spec.ts` | `/health`, `/health/db` + migration head; 404 không route vẫn là problem+json kèm `requestId`; echo `X-Request-Id` |
| `test/http/auth.spec.ts` | 401 với token thiếu/sai/hết hạn/chữ ký sai; token hợp lệ nhưng thiếu profile ⇒ 404; role đọc từ DB (`@Roles` probe); `isBlocked` ⇒ 403 `ACCOUNT_BLOCKED` (nhưng vẫn xem được `/me`) |
| `test/http/auth-jwks.spec.ts` | Verify ES256 qua JWKS server thật (local): chấp nhận token đúng key; từ chối `kid` lạ, key khác, issuer khác; xoay key (unknown `kid` ⇒ refresh JWKS) hoạt động |
| `test/http/wallet.spec.ts` | `/wallet` = `"0"` cho user mới; statement keyset không trùng/sót; validate `take`/`cursor` ⇒ 400 `VALIDATION_ERROR` |
| `test/http/orders-pay.spec.ts` | pay-wallet: buyer −gross, ESCROW +gross, order `PAID`; replay cùng key ⇒ `Idempotent-Replayed`; khác intent ⇒ 409 `IDEMPOTENCY_CONFLICT`; thiếu key ⇒ 400; thiếu tiền ⇒ 409 + balance nguyên vẹn + retry cùng key sau khi nạp thành công; không phải buyer ⇒ 403; đơn sai trạng thái ⇒ 409; cuối suite `LedgerIntegrity.total_drift = 0` và không ví nào drift |

Chi tiết phát hiện/sửa trong phiên: [../banking-design-review.md](../../banking-design-review.md).

## 6.12. Quy tắc code bắt buộc

1. `@Transactional`-tương đương (`prisma.$transaction`) chỉ ở tầng service;
   transaction ngắn, không gọi mạng bên trong.
2. Controller (khi có) không bao giờ trả entity thô - luôn map sang DTO.
3. Tiền là `Prisma.Decimal`; cấm `number`/`float` cho tiền.
4. Không catch `Exception` để "chạy tiếp"; lỗi nghiệp vụ là domain error có
   `code`.
5. Mọi kết nối mạng ra ngoài (PSP, Storage) không nằm trong transaction tiền.
6. Thay đổi hành vi tiền ⇒ bổ sung/sửa test tương ứng trong cùng PR; không có
   ngoại lệ.

