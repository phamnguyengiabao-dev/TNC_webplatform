> ⚠️ **REVISION 2026-10-14 — mô hình bán hàng đã đổi sang Shopee.** Showroom không xử lý thanh toán; nút mua deep-link sang gian hàng Shopee; backend tập trung **đồng bộ dữ liệu mặt hàng với Shopee**. Các nội dung wallet/escrow/orders/payment trong tài liệu này thuộc mô hình cũ — thay thế bởi [SHOPEE_SHOWROOM_BACKEND.md](backend/SHOPEE_SHOWROOM_BACKEND.md).

# Sprint Setup and Endpoint Testing - TNC Web Platform

> **Trạng thái: ✅ hoàn thành 2026-10-14.** Toàn bộ task trong mục 5 đã xong,
> acceptance criteria mục 7 đạt, bằng chứng ở mục 6.1. Tài liệu giữ nguyên cấu
> trúc kế hoạch ban đầu để đối chiếu; nội dung "khi làm" đã chuyển thành "đã
> làm" kèm ghi chú thiết kế thực tế.

> **S2 + S3 đã hoàn tất; S4 Affiliate đang triển khai** —
> theo dõi tại [backend/SHOPEE_SHOWROOM_BACKEND.md](backend/SHOPEE_SHOWROOM_BACKEND.md)
> mục 6, 10 và 11. Hiện bộ kiểm thử có **46 unit + 125 e2e test** (2026-10-14); các
> endpoint `/wallet*`, `/orders/{id}/pay-wallet` thuộc mô hình cũ đang chờ gỡ.

Tài liệu này mô tả sprint **dựng tầng HTTP cho NestJS** (auth guard +
ProblemDetail + các endpoint đầu tiên) trên nền banking core đã có, kèm cách
setup môi trường local và kịch bản test endpoint.

## 1. Mục tiêu sprint (đã đạt)

1. ✅ Bootstrap ứng dụng HTTP: `src/main.ts` + `AppModule` + `ConfigModule`
   (`src/config/configuration.ts`) + validation pipe toàn cục
   (`whitelist` + `forbidNonWhitelisted`).
2. ✅ **Auth guard**: verify JWT Supabase qua JWKS (ES256/RS256) hoặc HS256
   secret, map `sub` → `UserProfile`, đọc role/`isBlocked` từ DB mỗi request,
   decorator `@CurrentUser()` / `@Roles()` / `@RequireActiveAccount()` /
   `@Public()`.
3. ✅ **ProblemDetail filter**: `@Catch()` map domain error (`ledger.errors.ts`)
   và lỗi HTTP → RFC 7807 (`application/problem+json`) + `code` ổn định;
   message nội bộ (wallet id, số tiền, message Prisma) chỉ vào log.
4. ✅ **Idempotency interceptor** + `IdempotencyService` dùng `IdempotencyRecord`
   cho POST tiền, bắt đầu với `POST /orders/{id}/pay-wallet`.
5. ✅ Các endpoint đầu tiên:
   - `GET /health`, `GET /health/db`
   - `GET /me`
   - `GET /wallet`, `GET /wallet/statement`
   - `POST /orders/{id}/pay-wallet` (nối vào `BankingService.payForOrder`)
6. ✅ **HTTP e2e test** (supertest) cho các endpoint trên; toàn bộ test cũ vẫn
   xanh (`npm test`: 17 unit + 74 e2e = **91 test**).

Ngoài scope sprint này (giữ nguyên cho sprint sau, theo 13 mục 13.5): webhook
PSP, jobs, module catalog/listing/order đầy đủ, frontend.

## 2. Hiện trạng repo (sau sprint)

| Hạng mục | Trạng thái |
| -------- | ---------- |
| Ledger core + banking flows + schema/guards | ✅ đã code, đã test |
| Test suite | ✅ 17 unit + 74 e2e = 91 test pass (2026-10-14) |
| HTTP API (health/me/wallet/pay-wallet), auth guard, ProblemDetail, idempotency API | ✅ đã code, đã test HTTP + smoke test bằng `node dist/main.js` |
| `package.json` scripts | ✅ đủ: `build`, `start`, `start:dev`, `start:prod`, `typecheck`, `test*`, `prisma:*` |
| Shopee sync S2 (`src/modules/shopee`, `src/modules/sync`) | ✅ đã code + test (xem [backend/SHOPEE_SHOWROOM_BACKEND.md](backend/SHOPEE_SHOWROOM_BACKEND.md) mục 9) |

## 3. Cài đặt môi trường local

Yêu cầu: Node ≥ 22, npm; PostgreSQL 18 cục bộ (chỉ cần cho harness - xem mục 4)
hoặc để harness tự dựng.

```bash
npm ci                                   # cài đúng lockfile
cp .env.example .env                     # rồi điền giá trị thật (không commit .env)

npm run typecheck                        # tsc --noEmit
npm run test:unit                        # 17 test logic tiền/hoa hồng
npm run test:e2e                         # 74 test trên PostgreSQL thật (harness tự dựng)
npm test                                 # cả hai, chạy tuần tự
npm run build && npm start               # chạy app (mặc định http://localhost:3000/api/v1)
```

Biến trong `.env` cho chạy app local:

```env
DATABASE_URL="postgresql://postgres.<ref>:<pass>@<region>.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1"
DIRECT_URL="postgresql://postgres.<ref>:<pass>@<region>.pooler.supabase.com:5432/postgres"
APP_COMMISSION_BPS=500
SUPABASE_URL="https://<project-ref>.supabase.co"   # verify JWT qua JWKS
SUPABASE_JWT_SECRET=""                             # chỉ khi project ký HS256 legacy
CORS_ORIGINS="http://localhost:3000"
APP_VERSION="0.0.0"
```

- Có thể dùng Supabase project dev riêng hoặc PostgreSQL local; chỉ cần
  `prisma migrate deploy` đã chạy (schema + guards + ví hệ thống).
- Đổi schema: `npx prisma migrate dev --create-only --name <việc>` → review SQL
  → `npx prisma migrate deploy` → `npx prisma generate` (quy trình tại
  [database/DATABASE.md](database/DATABASE.md) mục 7).
- Không set `SUPABASE_URL`/`SUPABASE_JWT_SECRET` thì mọi request cần auth trả
  `500 AUTH_NOT_CONFIGURED` (fail closed, cố ý).

## 4. Test harness (không cần cấu hình gì)

- `test/setup/pg-harness.ts` tự dựng PostgreSQL 18 bằng `initdb` tại
  `%TEMP%\tnc-pg-test-data`, cổng `55432`, trust auth.
- Mỗi lần chạy: drop/recreate database `tnc_test` → `prisma migrate deploy` →
  chạy test → tắt server.
- Muốn dùng database sẵn có (CI service container `postgres:18`): đặt
  `TEST_DATABASE_URL` - harness sẽ dùng thay vì tự dựng.
- HTTP test không cần Supabase: `test/setup/load-test-env.ts` set
  `SUPABASE_JWT_SECRET` là secret của test, test tự ký token HS256; nhánh JWKS
  được test bằng ES256 + JWKS server local (`test/http/auth-jwks.spec.ts`).
- Jest chạy qua Node với `--experimental-vm-modules` (NestJS 12 ESM) - đã đóng
  gói trong npm scripts; không chạy `jest` trực tiếp.

## 5. Task list sprint (kết quả)

| # | Việc | Deliverable | Trạng thái |
| - | ---- | ----------- | ---------- |
| 1 | `src/main.ts` + `AppModule` + config/validation pipe | `src/main.ts`, `src/app.module.ts`, `src/app.setup.ts` - app khởi động, `/health` 200 | ✅ |
| 2 | `AuthModule`: JWKS verifier + guard + `@Roles` | `src/modules/auth/*`, `src/common/auth/*` - 401/403 đúng; role đọc từ DB | ✅ |
| 3 | `ProblemDetailFilter` + error mapping | `src/common/http/error-catalog.ts` + `problem-detail.filter.ts` - mọi lỗi là `application/problem+json` + `code` | ✅ |
| 4 | `IdempotencyService` + interceptor | `src/modules/idempotency/*` - POST lặp key ⇒ replay; khác intent ⇒ 409 | ✅ |
| 5 | `GET /me` | `src/modules/identity/*` - hồ sơ + role + số dư ví (chuỗi) | ✅ |
| 6 | `GET /wallet`, `GET /wallet/statement` | `src/modules/wallet/*` - nối `getBalance`/`getStatement` | ✅ |
| 7 | `POST /orders/{id}/pay-wallet` | `src/modules/orders/*` - nối `payForOrder` + idempotency + 403/404 | ✅ |
| 8 | HTTP e2e test (supertest) | `test/http/*.spec.ts` (6 file) + helpers | ✅ |
| 9 | Script `start`/`start:dev` vào package.json | `nest start`, `nest start --watch`, `node dist/main.js` | ✅ |
| 10 | Cập nhật `docs/` trạng thái ✅/🟨 | README, 06, 11, DEPLOYMENT, API_TESTING, sprint doc | ✅ |

## 6. Kế hoạch test endpoint (sprint này) và kết quả

Đặt biến Postman như [api/API_TESTING.md](api/API_TESTING.md) mục 0.

| # | Kịch bản | Kỳ vọng | Kết quả |
| - | -------- | ------- | ------- |
| 1 | `GET /health` | 200 `{ "status": "ok" }` | ✅ `test/http/health.spec.ts` |
| 2 | `GET /health/db` | 200 + migration head | ✅ (trả `20261014053909_finance_core`) |
| 3 | `GET /me` không token | 401 `UNAUTHENTICATED`, body problem+json | ✅ `test/http/auth.spec.ts` |
| 4 | `GET /me` có token | 200, role đúng từ DB | ✅ (kể cả case role STAFF qua probe `@Roles`) |
| 5 | `GET /wallet` user chưa giao dịch | 200 `balance = "0"` | ✅ `test/http/wallet.spec.ts` |
| 6 | `GET /wallet/statement` phân trang | `data` + `nextCursor`; cursor hoạt động | ✅ |
| 7 | `POST /orders/{id}/pay-wallet` đủ tiền | 200 `PAID`; số dư giảm; escrow tăng | ✅ `test/http/orders-pay.spec.ts` |
| 8 | `POST /orders/{id}/pay-wallet` thiếu tiền | 409 `INSUFFICIENT_FUNDS`; số dư không đổi | ✅ |
| 9 | Gọi lặp #7 cùng `Idempotency-Key` | Replay (`Idempotent-Replayed: true`), không trừ thêm | ✅ |
| 10 | Gọi lặp #7 khác intent cùng key | 409 `IDEMPOTENCY_CONFLICT` | ✅ (khác order id, khác endpoint đều 409) |
| 11 | Sai chủ đơn (buyer khác) | 403 `FORBIDDEN` | ✅ |
| 12 | Sau toàn bộ kịch bản: `select * from "LedgerIntegrity"` | `total_drift = 0` | ✅ assert trong `afterAll` của suite pay-wallet |
| 13 | Sau toàn bộ kịch bản: ví nào drift <> 0 | RỖNG | ✅ `BankingService.findBalanceDrift()` rỗng |

Bổ sung ngoài kế hoạch ban đầu (phát sinh khi code, đã test):

- `Idempotency-Key` thiếu ⇒ 400 `IDEMPOTENCY_KEY_REQUIRED`; key > 128 ký tự ⇒
  400 `VALIDATION_ERROR`.
- Sau một lần thất bại (409), record idempotency bị **xoá** để client retry
  cùng key sau khi nạp thêm tiền - có test riêng.
- Đơn sai trạng thái (`CANCELLED`) ⇒ 409 `INVALID_STATE_TRANSITION`.
- Token hợp lệ nhưng chưa có `UserProfile` ⇒ 404 `PROFILE_NOT_FOUND`.
- Token hết hạn / sai chữ ký / sai issuer / kid lạ ⇒ 401; JWKS down ⇒ 503.
- `take`/`cursor` sai hoặc tham số lạ ⇒ 400 `VALIDATION_ERROR` kèm `errors[]`.

Ví dụ smoke test bằng curl (đã chạy thật với `node dist/main.js`):

```bash
BASE_URL=http://localhost:3000/api/v1
curl -s $BASE_URL/health
curl -s $BASE_URL/health/db
curl -s $BASE_URL/me -H "Authorization: Bearer $BUYER_TOKEN"
curl -s "$BASE_URL/wallet/statement?take=20" -H "Authorization: Bearer $BUYER_TOKEN"
```

## 6.1. Bằng chứng chạy thật (2026-10-14)

```text
npm test         → 17 unit + 74 e2e = 91 test, PASS
npm run build    → OK (dist/main.js)
node dist/main.js (DATABASE_URL trỏ DB test)
  GET  /api/v1/health        → 200 {"status":"ok","version":"smoke-1.0.0"}
  GET  /api/v1/health/db     → 200 migration 20261014053909_finance_core
  GET  /api/v1/me (no token) → 401 problem+json UNAUTHENTICATED, X-Request-Id echo
  GET  /api/v1/me (token)    → 200 profile + wallet "0"
  POST /api/v1/orders/{id}/pay-wallet (no key)  → 400 IDEMPOTENCY_KEY_REQUIRED
  POST /api/v1/orders/not-a-uuid/pay-wallet     → 400 VALIDATION_ERROR + errors[]
  POST /api/v1/orders/{id}/pay-wallet (unknown order) → 404 NOT_FOUND
```

## 7. Acceptance criteria (nghiệm thu sprint)

- [x] `npm test` xanh **bao gồm cả HTTP e2e test mới** (không hồi quy 51 test cũ;
      hiện 91 test).
- [x] `npm run typecheck` và `npm run build` sạch.
- [x] Mọi lỗi trả theo RFC 7807 + `code`; test assert body không chứa message
      nội bộ ("cannot cover", wallet id).
- [x] auth guard: 401/403 đúng; role lấy từ `UserProfile`; user `isBlocked` bị
      chặn endpoint tiền (`403 ACCOUNT_BLOCKED`) nhưng vẫn xem được `/me`.
- [x] Idempotency hoạt động: replay + conflict + in-progress (in-progress đọc
      từ `IdempotencyRecord`; race được xử lý bằng upsert + P2002).
- [x] `LedgerIntegrity.total_drift = 0` và không ví nào drift sau các kịch bản.
- [x] `/health` sẵn sàng cho container host ping (`/api/v1/health`); có
      `X-Request-Id` xuyên suốt (echo header nếu client gửi).
- [x] Tài liệu 06/11/README/DEPLOYMENT/API_TESTING cập nhật trạng thái tương ứng.

## 8. Sau sprint này

| Sprint | Nội dung |
| ------ | -------- |
| S2 | Đơn hàng: `POST /orders`, `cancel`, `confirm-received`, job hết hạn giữ chỗ + audit |
| S3 | Nạp tiền: topup intent + webhook verify chữ ký + replay test |
| S4 | Listing C2C + duyệt tin + staff UI (release/refund/withdraw) |
| S5 | Catalog B2C + flash sale + frontend |

Việc không chờ sprint: chạy 2 câu diagnostic RLS trên Supabase project thật
(xem [database/DATABASE.md](database/DATABASE.md) mục 3.2).

## 9. Tài liệu liên quan

- [Spectification/TNCWebPlatform/06_Backend.md](Spectification/TNCWebPlatform/06_Backend.md) - cấu trúc module, error taxonomy
- [Spectification/TNCWebPlatform/11_API_Specification.md](Spectification/TNCWebPlatform/11_API_Specification.md) - hợp đồng API
- [api/API_TESTING.md](api/API_TESTING.md) - bộ kịch bản test đầy đủ
- [database/DATABASE.md](database/DATABASE.md) - schema, guards, migration
- [deployment/DEPLOYMENT.md](deployment/DEPLOYMENT.md) - deploy và go-live
