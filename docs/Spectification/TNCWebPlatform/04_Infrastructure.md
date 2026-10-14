# 04. Hạ tầng

## 4.1. Tổng quan

| Thành phần | Dịch vụ | Vai trò | Trạng thái |
| ---------- | ------- | ------- | ---------- |
| Database | Supabase Postgres | Toàn bộ dữ liệu; bất biến tiền tệ ở tầng DB | ✅ (schema + guards đã áp dụng & test) |
| Object storage | Supabase Storage | Ảnh sản phẩm/listing, ảnh chứng minh, CDN + resize | ⬜ (bucket chưa tạo) |
| Auth | Supabase Auth | Đăng ký/đăng nhập, OAuth, JWT | ⬜ (thiết kế + trigger đã có trong migration) |
| Backend | NestJS (container) | Business logic + banking vault + webhook + job | 🟨 (service đã có; HTTP/host chưa) |
| Frontend | Next.js trên Vercel | Web B2C/C2C/staff | ⬜ |
| CI/CD | GitHub Actions | typecheck, test, build, migrate | ⬜ (kịch bản tại 4.7) |
| PSP | PayOS / VietQR (VN), Stripe (dự phòng) | Nạp tiền, chi trả lệnh rút | ⬜ |

Nguyên tắc hạ tầng: **managed services cho hạ tầng, container cho backend**.
Supabase lo Postgres/Storage/Auth; backend là long-running process (không
serverless) để có transaction và scheduled job ổn định.

## 4.2. Supabase

### 4.2.1. Kết nối database

Hai đường kết nối bắt buộc phân biệt (đã cấu hình trong `prisma/schema.prisma`):

| Biến | Đường kết nối | Dùng cho |
| ---- | ------------- | -------- |
| `DATABASE_URL` | Transaction pooler, port `6543`, `?pgbouncer=true&connection_limit=1` | NestJS runtime - pool nhỏ, transaction ngắn |
| `DIRECT_URL` | Direct connection, port `5432` | `prisma migrate` (cần session-level statements) |

Lưu ý vận hành:

- Transaction pooler không hỗ trợ prepared statements - tham số
  `pgbouncer=true` là bắt buộc, Prisma đã xử lý.
- Interactive transaction chiếm connection trong suốt thời gian chạy - mọi
  transaction tiền phải ngắn (timeout 15 s, maxWait 5 s trong code), tuyệt đối
  không gọi HTTP/PSP bên trong.
- Giới hạn pool mặc định của Supabase theo gói; nếu cần hơn, dùng thêm
  connection pooler phía app hoặc Direct cho read-only.

### 4.2.2. Bảo mật tầng database

Áp dụng từ `prisma/sql/finance_guards.sql` (đã nhúng vào migration):

| Biện pháp | Nội dung |
| --------- | -------- |
| RLS | Bật trên toàn bộ bảng tài chính/nghiệp vụ; không policy nào ⇒ default-deny với `anon`/`authenticated` |
| Revoke | Thu hồi toàn bộ quyền của `anon`/`authenticated` trên các bảng finance |
| Default privileges | Chặn Supabase tự cấp quyền cho bảng mới ⇒ muốn mở bảng cho frontend phải là hành động tường minh (grant + policy + review) |
| Service role key | Chỉ nằm ở backend; không bao giờ xuất hiện trong bundle frontend |
| Anon key | Được phép public (ship trong frontend bundle) vì RLS đã default-deny |

Hai câu diagnostic phải chạy trên project Supabase thật trước khi go-live
(trích ở đầu `finance_guards.sql`): kiểm tra `relrowsecurity` và
`role_table_grants` cho `anon`/`authenticated`.

### 4.2.3. Storage buckets

| Bucket | Public read | Nội dung | Ai upload | Trạng thái |
| ------ | ----------- | -------- | --------- | ---------- |
| `product-images` | ✅ | Ảnh sản phẩm B2C | Admin/Staff (qua backend) | ⬜ |
| `listing-images` | ✅ | Ảnh tin đăng second-hand (kèm ảnh chứng minh mua hàng) | Seller (qua backend upload URL) | ⬜ |
| `kyc-documents` | ❌ | Giấy tờ định danh seller (nếu bật xác minh) | Người dùng (qua backend) | ⬜ |

Quy tắc chung: backend quyết định đường dẫn (`listings/{userId}/{uuid}.jpg`),
frontend xin URL upload có chữ ký (signed upload) hoặc upload qua NestJS;
kích thước tối đa 5 MB/ảnh, tối đa 10 ảnh/listing (mặc định tạm - chờ chốt).
Supabase Storage tự nén/resize phục vụ CDN.

### 4.2.4. Supabase Auth

| Hạng mục | Cấu hình |
| -------- | -------- |
| Providers | Email/password; Google OAuth; Facebook OAuth |
| JWT | Thuật toán bất đối xứng (ES256/RS256); backend verify qua JWKS `https://<ref>.supabase.co/auth/v1/.well-known/jwks.json` |
| Provisioning | Trigger `auth.users` (trong migration) tạo `UserProfile` + ví VND cho mỗi user mới |
| Role nghiệp vụ | Đọc từ `UserProfile.role` (USER/STAFF/ADMIN) ở backend - không tin claim phía client |
| Email | SMTP mặc định của Supabase cho bản đầu; chuyển sang nhà cung cấp riêng khi lên production |

## 4.3. Biến môi trường

| Biến | Phạm vi | Bí mật | Mô tả |
| ---- | ------- | ------ | ----- |
| `DATABASE_URL` | Backend | ✅ | Postgres qua transaction pooler (6543) |
| `DIRECT_URL` | Backend/CI | ✅ | Postgres direct (5432) - chỉ cho migration |
| `SUPABASE_URL` | FE + BE | ❌ | URL project Supabase |
| `SUPABASE_ANON_KEY` | FE | ❌ | Anon key cho Supabase Auth phía client |
| `SUPABASE_SERVICE_ROLE_KEY` | Backend | ✅ | Thao tác Storage/admin - chỉ server |
| `APP_COMMISSION_BPS` | Backend | ❌ | Hoa hồng nền tảng, basis points (mặc định `500` = 5.00%) |
| `APP_RESERVATION_MINUTES` | Backend | ❌ | Thời gian giữ chỗ đơn hàng (mặc định tạm `10`) - cần chốt |
| `APP_AUTO_RELEASE_DAYS` | Backend | ❌ | Số ngày auto-release escrow sau DELIVERED (đề xuất `3`) - cần chốt |
| `PAYOS_CLIENT_ID` / `PAYOS_API_KEY` / `PAYOS_CHECKSUM_KEY` | Backend | ✅ | PSP nạp tiền VN (khi tích hợp) |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | Backend | ✅ | PSP dự phòng |
| `CORS_ORIGINS` | Backend | ❌ | Danh sách origin frontend được phép |
| `PORT` | Backend | ❌ | Cổng HTTP của NestJS (mặc định 3000) |

File mẫu: `.env.example` ở gốc repo. Không commit `.env`.

## 4.4. Môi trường

| Môi trường | Database | Backend | Frontend | Mục đích |
| ---------- | -------- | ------- | -------- | -------- |
| Local | PostgreSQL local (hoặc Supabase `dev`) | `nest start --watch` | `next dev` | Phát triển + test (`npm test` dùng harness PostgreSQL riêng) |
| Staging | Supabase project `staging` | Container host | Vercel Preview | UAT, diễn tập migrate, test webhook sandbox |
| Production | Supabase project `production` | Container host (≥2 instance) | Vercel + domain chính | Vận hành thật |

Quy tắc: staging và production là hai Supabase project tách biệt; mọi migration
chạy staging trước ≥ 24 giờ.

## 4.5. Hosting backend

| Phương án | Ưu | Nhược | Khuyến nghị |
| --------- | -- | ----- | ----------- |
| Container host (Railway/Render/Fly.io) | Nhanh, có health check, scale ngang | Chi phí theo instance | ✅ Mặc định |
| VPS + Docker Compose | Toàn quyền, rẻ khi tải thấp | Tự vận hành | Phương án dự phòng |
| Serverless (Vercel/Lambda) | Không quản hạ tầng | Transaction + pool + job không phù hợp với banking core | ❌ Không dùng |

Yêu cầu tối thiểu: health endpoint (`GET /health` ⬜), log ra stdout (structured
JSON), graceful shutdown (Prisma disconnect), timezone container UTC.

## 4.6. CI/CD (GitHub Actions)

```yaml
# Kịch bản mục tiêu - chưa tạo file workflow
jobs:
  verify:
    steps:
      - npm ci
      - npm run typecheck
      - npm run prisma:validate      # cần DATABASE_URL/DIRECT_URL trong env
      - npm run test:unit
      - npm run test:e2e             # harness tự dựng PostgreSQL, hoặc TEST_DATABASE_URL
      - npm run build
  migrate:
    needs: verify
    if: branch == main
    steps:
      - npx prisma migrate deploy    # DIRECT_URL của staging → sau đó production
```

Ghi chú: `test:e2e` trong CI có thể dùng `TEST_DATABASE_URL` trỏ service
container `postgres:18` thay cho harness `initdb` (harness tự nhận biến này).

## 4.7. Logging và giám sát

| Hạng mục | Cách làm |
| -------- | -------- |
| Application log | NestJS Logger → stdout JSON; mọi log tiền tệ kèm transferId/idempotencyKey |
| Correlation id | Sinh ở đầu request, trả trong header `X-Request-Id` (khi có HTTP layer) |
| Cảnh báo bắt buộc | Drift ≠ 0 (`WalletReconciliation`); transfer không cân bằng; webhook verify fail liên tục; tỷ lệ thanh toán lỗi |
| Database | Supabase logs + `pg_stat_statements`; chậm > 500 ms phải điều tra |
| Đối soát định kỳ | Job đọc `WalletReconciliation` và `LedgerIntegrity` mỗi giờ; alert khi lệch |
| Uptime | Health check của container host, ping 30 s |

## 4.8. Backup và khôi phục

- Supabase PITR được bật ở gói phù hợp; tối thiểu daily backup giữ 7 ngày.
- Migration là forward-only; rollback bằng migration mới (không sửa migration đã
  áp dụng).
- Kịch bản khôi phục sự cố dữ liệu: restore PITR → chạy diagnostic RLS →
  `prisma migrate status` xác nhận head → chạy `WalletReconciliation`.
- Nhật ký sự cố (incident log) lưu tại `docs/` khi có sự cố thật đầu tiên.
