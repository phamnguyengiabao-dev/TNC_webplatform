# TNC Web Platform - Deployment Guide

Tài liệu này mô tả cách đưa TNC Web Platform lên môi trường thật:
**Supabase** (Postgres + Auth + Storage), **NestJS** (container host, không
serverless) và **Next.js** (Vercel). Bổ sung cho chương
[04_Infrastructure.md](../Spectification/TNCWebPlatform/04_Infrastructure.md).

## 1. Kiến trúc triển khai

```text
Người dùng
   |
   v
Vercel (Next.js)  ---> Supabase Auth (JWT)
   |           \
   |            \-- Supabase Storage CDN (ảnh)
   v
Container host (NestJS, >= 2 instance)
   |  DATABASE_URL (pooler 6543)
   |  DIRECT_URL (5432) - chỉ cho migration
   v
Supabase Postgres (staging | production, tách biệt)
   ^
   | webhook đã verify chữ ký
PSP / Ngân hàng (PayOS, VietQR, Stripe dự phòng)
```

Nguyên tắc:

- NestJS là process dài hạn (transaction + scheduled jobs) - **không** chạy
  serverless.
- Staging và production là **hai Supabase project tách biệt**; mọi migration
  chạy staging trước ≥ 24 giờ.
- Migration chạy bằng bước release riêng (CI), không chạy tự động trong app
  startup.

## 2. Chuẩn bị tài khoản và secret

| Hạng mục | Dùng cho |
| -------- | -------- |
| 2 Supabase project (`tnc-staging`, `tnc-production`) | Postgres, Auth, Storage |
| Container host (Railway/Render/Fly.io/VPS) | Backend NestJS |
| Vercel account | Frontend Next.js |
| PSP sandbox + live (PayOS/VietQR; Stripe dự phòng) | Nạp tiền, chi trả |
| Domain + HTTPS | Frontend, API, webhook URL |

Nguyên tắc secret: `service_role key`, `DIRECT_URL`, PSP keys chỉ nằm ở backend
(platform env vars); **không bao giờ** vào bundle frontend hoặc repo.

## 3. Supabase setup (mỗi môi trường)

### 3.1. Tạo project và lấy thông tin

1. Tạo project; lưu `Project ref`, region (chọn gần VN: Singapore).
2. Bật email auth; cấu hình OAuth Google/Facebook (nếu dùng).
3. Lấy connection strings:
   - `DATABASE_URL` = transaction pooler port 6543 kèm
     `?pgbouncer=true&connection_limit=1`;
   - `DIRECT_URL` = direct port 5432 (dùng duy nhất cho migration).
4. Lấy `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.
5. Tạo Storage buckets: `product-images` (public read), `listing-images`
   (public read), `kyc-documents` (private) - thiết lập size limit 5 MB và MIME
   allowlist.

### 3.2. ⚠️ Chạy diagnostic RLS TRƯỚC TIÊN

Trên project thật, chạy hai câu ở đầu `prisma/sql/finance_guards.sql` **trước
khi làm bất cứ việc gì khác**:

```sql
select relname, relrowsecurity as rls_enabled
  from pg_class
 where relnamespace = 'public'::regnamespace and relkind = 'r'
 order by relname;

select table_name, grantee, privilege_type
  from information_schema.role_table_grants
 where table_schema = 'public'
   and grantee in ('anon', 'authenticated')
 order by table_name, grantee;
```

Nếu bảng tài chính đang `rls_enabled = false` hoặc `anon` có
INSERT/UPDATE/DELETE ⇒ coi là sự cố đang xảy ra: chạy ngay mục 1 của
`finance_guards.sql` (hoặc `prisma migrate deploy` ở bước sau đó).

### 3.3. Áp schema + guards

```bash
# Trên máy có repo, trỏ .env vào DIRECT_URL của project đích
npx prisma migrate deploy      # cài schema + toàn bộ guards + seed ví hệ thống
npx prisma migrate status      # xác nhận head, không có migration treo
npx prisma generate
```

Sau khi migrate, kiểm tra:

```sql
-- 4 ví hệ thống phải tồn tại, balance = 0
select code, kind, balance from "Wallet" where code is not null order by code;

-- Trigger provisioning auth.users (nếu thiếu, chạy mục 7 guards bằng SQL editor)
select tgname from pg_trigger where tgrelid = 'auth.users'::regclass and not tgisinternal;

-- Chạy lại 2 câu diagnostic RLS ở 3.2 - kỳ vọng đúng như tài liệu
```

### 3.4. Auth provisioning

- Trigger `on_auth_user_created` tạo `UserProfile` + ví VND cho mỗi user mới.
- Tạo tài khoản staff đầu tiên qua Supabase Auth, rồi set role:
  `update "UserProfile" set role = 'STAFF' where email = '...';`
- Bật xác nhận email; cấu hình SMTP riêng khi lên production (không dùng SMTP
  mặc định của Supabase cho production).

## 4. Backend - container host (NestJS)

### 4.1. Biến môi trường

| Biến | Bắt buộc | Ghi chú |
| ---- | -------- | ------- |
| `DATABASE_URL` | ✅ | Pooler 6543 + `pgbouncer=true&connection_limit=1` |
| `DIRECT_URL` | ✅ | Direct 5432 - chỉ dùng cho migration (CI/release step) |
| `SUPABASE_URL` | ✅ | URL project - dùng để verify JWT qua JWKS `/auth/v1/.well-known/jwks.json` |
| `SUPABASE_JWT_SECRET` | nếu project HS256 legacy | Chỉ cần khi access token còn ký bằng shared secret; project dùng signing keys asymmetric thì bỏ trống |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | Server-only |
| `SUPABASE_ANON_KEY` | nếu backend cần | Thường chỉ frontend cần |
| `APP_COMMISSION_BPS` | ❌ | Mặc định `500` (5,00%) - **chờ chốt** |
| `APP_RESERVATION_MINUTES` | ❌ | Mặc định `10` - chờ chốt |
| `APP_AUTO_RELEASE_DAYS` | ❌ | Mặc định `3` - chờ chốt |
| `PAYOS_CLIENT_ID` / `PAYOS_API_KEY` / `PAYOS_CHECKSUM_KEY` | khi tích hợp | PSP VN |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | khi tích hợp | PSP dự phòng |
| `CORS_ORIGINS` | ✅ | Danh sách origin frontend, phẩy phân cách (staging/production tách riêng); `*` = mọi origin (chỉ dev) |
| `APP_VERSION` | ❌ | Mặc định `0.0.0`; release pipeline set để `GET /health` trả đúng version |
| `IDEMPOTENCY_TTL_HOURS` | ❌ | Mặc định `24` - thời gian replay của `Idempotency-Key` |
| `PORT` | ❌ | Mặc định 3000 |

### 4.2. Dockerfile mục tiêu (⬜ chưa tạo - `src/main.ts` đã có từ 2026-10-14, image build theo khối dưới)

```dockerfile
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY prisma ./prisma
RUN npx prisma generate
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY package*.json ./
EXPOSE 3000
CMD ["node", "dist/main.js"]
```

Yêu cầu runtime:

- Health check: `GET /api/v1/health` (global prefix `api/v1`); container host ping 30 s. `/api/v1/health/db` để kiểm tra DB + migration head.
- Log ra stdout dạng JSON (không ghi file trong container).
- Graceful shutdown: `app.enableShutdownHooks()` + Prisma disconnect.
- Timezone container: UTC (thời gian trong DB là timestamptz).
- Scale ngang ≥ 2 instance ở production; scheduled jobs dùng advisory lock để
  không chạy trùng giữa các instance.

### 4.3. Release flow (khuyến nghị)

```text
1. CI: npm ci -> typecheck -> test -> build (image)
2. Release step: npx prisma migrate deploy (DIRECT_URL của môi trường đích)
3. Deploy image mới (rolling)
4. Smoke test: /api/v1/health, /api/v1/health/db, 1 giao dịch sandbox
```

Không chạy migration trong app startup (nhiều instance sẽ chạy đua nhau); không
gọi `prisma migrate dev` ở môi trường thật.
## 5. Frontend - Vercel (Next.js)

| Hạng mục | Giá trị |
| -------- | ------- |
| Framework preset | Next.js (App Router) |
| Biến môi trường | `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| Preview | Mỗi PR một preview deployment trỏ vào API staging |
| Production | Domain chính; chỉ promote từ PR đã pass checklist |

Lưu ý:

- **Không** đặt `SUPABASE_SERVICE_ROLE_KEY` trong Vercel env (kể cả server-side
  env) - mọi thao tác admin đi qua NestJS.
- `NEXT_PUBLIC_*` là công khai theo thiết kế; anon key chấp nhận được vì RLS đã
  default-deny các bảng nhạy cảm.
- Sau khi đổi `CORS_ORIGINS` ở backend, cập nhật đồng thời domain preview nếu
  cần test cross-origin.

## 6. CI/CD (GitHub Actions)

```yaml
name: verify-and-migrate
on:
  pull_request:
  push:
    branches: [main]

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm ci
      - run: npm run typecheck
      - run: npm run test:unit
      - run: npm run test:e2e          # harness tự dựng PostgreSQL 18 cục bộ
      - run: npm run build

  migrate-staging:
    needs: verify
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm ci
      - run: npx prisma migrate deploy
        env:
          DATABASE_URL: ${{ secrets.STAGING_DATABASE_URL }}
          DIRECT_URL: ${{ secrets.STAGING_DIRECT_URL }}
```

- CI cần `TEST_DATABASE_URL` trỏ service container `postgres:18` (tùy chọn) -
  harness tự nhận biến này; không đặt thì harness tự dựng bằng `initdb`.
- Production migrate là bước thủ công có xác nhận (manual approval) sau khi
  staging ≥ 24 h không sự cố.

## 7. Ma trận môi trường

| Hạng mục | Local | Staging | Production |
| -------- | ----- | ------- | ---------- |
| Database | PostgreSQL local / Supabase dev | Supabase project staging | Supabase project production |
| Backend | `nest start --watch` | 1 instance | ≥ 2 instance + health check |
| Frontend | `next dev` | Vercel preview | Vercel production + domain |
| PSP | sandbox / mock | sandbox | live keys |
| Dữ liệu | tự do | seed test | thật - không test tay |

## 8. Checklist go-live

### Kỹ thuật

- [ ] Chạy 2 diagnostic RLS trên production, kết quả đúng tài liệu (3.2).
- [ ] `prisma migrate status` sạch; 4 ví hệ thống tồn tại; trigger
      `on_auth_user_created` hoạt động (thử đăng ký 1 account test).
- [ ] `select * from "LedgerIntegrity"` → `total_drift = 0`.
- [ ] Webhook verify chữ ký chạy đúng với PSP thật (bắn thử 1 giao dịch nhỏ,
      replay 3 lần vẫn cộng 1 lần).
- [ ] Rate limit + CORS + HTTPS cho API; secret không nằm trong bundle frontend.
- [ ] Alerts: drift ≠ 0, webhook verify fail, lỗi thanh toán, job không chạy.
- [ ] Backup/PITR bật; đã diễn tập restore trên staging.
- [ ] `npm test` xanh trên commit release.
- [ ] Runbook sự cố + người trực on-call.

### Nghiệp vụ & pháp lý

- [ ] Ba con số nghiệp vụ đã chốt (hoa hồng, giữ chỗ, auto-release) và cấu
      hình đúng ở env production.
- [ ] Kết luận pháp lý mô hình ví/escrow (NFR-24) - **gate cho chức năng rút
      tiền**; nếu dùng mô hình PSP không tự giữ tiền, đã cấu hình payout đúng.
- [ ] Công bố: chính sách đổi trả/hoàn tiền, đơn vị thanh toán hợp tác, kênh
      khiếu nại, điều khoản sử dụng/chính sách bảo mật (12.11, NFR-25).
- [ ] Quy trình thuế sàn TMĐT + báo cáo doanh thu/hoa hồng (NFR-26).
- [ ] Đào tạo staff: duyệt tin, release/refund, duyệt rút tiền (chương 12.8).

### Kiểm thử end-to-end cuối cùng (trên staging, trước khi trỏ domain)

- [ ] Luồng B2C: duyệt catalog → tạo đơn → pay-wallet → giao → hoàn tất.
- [ ] Luồng C2C: đăng tin → duyệt → mua → pay → giao → release.
- [ ] Nạp tiền sandbox: topup → webhook → số dư; replay không cộng hai lần.
- [ ] Rút tiền: tạo → duyệt → settle; case fail → hoàn tiền về ví.
- [ ] Tranh chấp: mở dispute → refund; đối chiếu drift = 0 sau tất cả.

## 9. Rollback và xử lý sự cố

| Tình huống | Hành động |
| ---------- | --------- |
| Deploy lỗi phiên bản app | Rollback image về bản trước (stateless - không cần rollback DB nếu không đổi schema) |
| Migration lỗi | Không sửa migration đã áp; viết migration mới khắc phục (forward-only). Nếu đã hỏng dữ liệu: restore PITR + replay từ backup |
| Nghi ngờ mất cân bằng tiền | Tạm dừng endpoint tiền; chạy `LedgerIntegrity`, `WalletReconciliation`; khoanh vùng transfer liên quan qua audit; xử lý bằng transfer đảo/ADJUSTMENT có audit |
| Sự cố RLS (bảng bị mở) | Chạy mục 1 guards ngay; xoay key nếu nghi ngờ lộ service role; kiểm tra log PostgREST |
| PSP sự cố | Tắt kênh nạp tương ứng khỏi UI; webhook retry sẽ được replay idempotent khi PSP hồi phục |

Kịch bản chi tiết theo sự cố đầu tiên sẽ được ghi thành incident log tại
`docs/` theo thông lệ ở chương 04 mục 4.8.

## 10. Vận hành định kỳ

| Chu kỳ | Việc |
| ------ | ---- |
| Mỗi giờ | Job đối soát drift; alert khi ≠ 0 (khi job được triển khai) |
| Mỗi ngày | Kiểm tra log webhook fail, lệnh rút tồn đọng, đơn DELIVERED chờ release |
| Mỗi tuần | Đối chiếu `GATEWAY_CLEARING` với sao kê PSP; kiểm tra backup; review cảnh báo |
| Mỗi tháng | Diễn tập restore trên staging; rà soát quyền/role user; cập nhật dependency bảo mật |
