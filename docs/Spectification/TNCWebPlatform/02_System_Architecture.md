> ⚠️ **REVISION 2026-10-14 — mô hình bán hàng đã đổi sang Shopee.** Showroom không xử lý thanh toán; nút mua deep-link sang gian hàng Shopee; backend tập trung **đồng bộ dữ liệu mặt hàng với Shopee**. Các nội dung wallet/escrow/orders/payment trong tài liệu này thuộc mô hình cũ — thay thế bởi [SHOPEE_SHOWROOM_BACKEND.md](../../backend/SHOPEE_SHOWROOM_BACKEND.md).

# 02. Kiến trúc hệ thống

## 2.1. Kiến trúc tổng thể

Nền tảng gồm ba khối, phân chia trách nhiệm theo một nguyên tắc duy nhất: **dữ
liệu phẳng và hạ tầng thuê Supabase, logic nghiệp vụ và tiền thuộc NestJS**.

```text
                  +-------------------------------------------+
                  |              Người dùng                   |
                  |  Buyer / Seller / Staff / Admin (web)      |
                  +---------------------+---------------------+
                                        |
                          HTTPS         v
                  +-------------------------------------------+
                  |   Next.js (App Router, shadcn/ui)         |
                  |   - Giao diện B2C / C2C / ví / staff       |
                  |   - Đăng nhập trực tiếp Supabase Auth      |
                  +--------+--------------------------+-------+
                           |                          |
             Supabase Auth | JWT               REST + JWT (Bearer)
                           v                          v
        +--------------------------+   +--------------------------------+
        |       Supabase           |   |         NestJS API              |
        |  - Auth (JWT, social)    |   |  - Marketplace: catalog,       |
        |  - Postgres (dữ liệu)    |<--|    listing, order, checkout    |
        |  - Storage/CDN (ảnh)     |   |  - Banking vault: wallet,      |
        |                          |   |    ledger, escrow, withdrawal  |
        +--------------------------+   |  - Webhook PSP (verify chữ ký) |
                    ^                  |  - Scheduled jobs (release...) |
                    |  Prisma          +--------------------------------+
                    |                          |
                    |                          | verify chữ ký
                    |                          v
                    |                  +------------------+
                    |                  |  PSP: PayOS /    |
                    +------------------|  VietQR / Stripe |
                     webhook đã xác thực +------------------+
```

Sơ đồ quyết định quan trọng: **frontend được gọi thẳng Supabase Auth** (đăng
nhập, đăng ký, quên mật khẩu, OAuth Google/Facebook) để nhận JWT; nhưng
**không bao giờ được ghi tiền trực tiếp vào Postgres**. Mọi thao tác tiền đi
qua NestJS, nơi có transaction, idempotency và audit.

## 2.2. Phân chia trách nhiệm

| Khối | Chịu trách nhiệm | Không được làm |
| ---- | ---------------- | -------------- |
| Supabase Postgres | Lưu toàn bộ dữ liệu; bảo vệ bất biến tiền tệ bằng constraint/trigger; phục vụ RLS cho dữ liệu công khai | Không chứa logic nghiệp vụ |
| Supabase Storage | Lưu và phân phối ảnh sản phẩm/listing qua CDN; resize tự động | Không tin metadata do client gửi (backend quyết định đường dẫn) |
| Supabase Auth | Đăng ký/đăng nhập/quên mật khẩu/OAuth; phát hành JWT; trigger provisioning UserProfile + ví | Không chứa phân quyền nghiệp vụ (role nằm ở `UserProfile`) |
| NestJS | Toàn bộ nghiệp vụ: catalog, listing + duyệt, đặt hàng, ví, ledger, escrow, rút tiền, webhook, audit, job định kỳ | Không trả entity thô ra API; không để lộ số dư ví qua thông báo lỗi |
| Next.js | UI/UX, phiên đăng nhập, gọi NestJS kèm JWT | Không tính tiền; không quyết định trạng thái đơn |
| PSP | Xác nhận giao dịch nạp tiền; chi trả lệnh rút | Không được tin payload client; chỉ tin webhook đã verify chữ ký |

## 2.3. Nguyên tắc kiến trúc bắt buộc

| # | Nguyên tắc | Cơ chế thực thi |
| - | ---------- | --------------- |
| A1 | Tiền chỉ di chuyển qua NestJS | RLS mặc định đóng + `revoke all` với `anon`/`authenticated` trên các bảng tài chính (xem dưới); frontend chỉ có API |
| A2 | Số dư ví là dữ liệu dẫn xuất của ledger | `Wallet.balance` chỉ được cập nhật bởi `LedgerService.post()`; view `WalletReconciliation` phát hiện drift |
| A3 | Mọi transfer phải cân bằng (tổng leg = 0) | Deferred constraint trigger `assert_transfer_balanced` chặn ở COMMIT |
| A4 | Ledger append-only | Trigger chặn UPDATE/DELETE trên `LedgerEntry`; `LedgerTransfer` chỉ đổi được `status` |
| A5 | Thao tác tiền phải idempotent | Unique `LedgerTransfer.idempotencyKey` + header `Idempotency-Key` ở API |
| A6 | Không gọi hệ thống ngoài trong transaction | PSP/HTTP chỉ gọi trước hoặc sau transaction; webhook nhận rồi mới mở transaction ngắn |
| A7 | Kiểm tra quyền ở tầng DB, không chỉ code | Constraint ví không âm, escrow không âm, whole-đồng, FK Restrict |
| A8 | Mọi thay đổi trạng thái nghiệp vụ có audit | `AuditLog` ghi cùng transaction với thay đổi |

## 2.4. Các luồng nghiệp vụ chính

### 2.4.1. Mua mỹ phẩm second-hand (luồng xương sống)

```mermaid
sequenceDiagram
    autonumber
    participant B as Buyer (Next.js)
    participant SA as Supabase Auth
    participant N as NestJS
    participant DB as Postgres (ledger)
    participant S as Seller

    B->>SA: đăng nhập
    SA-->>B: JWT (sub = user id)
    B->>N: GET /api/v1/products?type=SECONDHAND
    N->>DB: đọc listing đã duyệt
    DB-->>N: listing (qty = 1)
    B->>N: POST /api/v1/orders (JWT + Idempotency-Key)
    N->>DB: transaction: kiểm tra tồn kho/giữ chỗ, tạo Order PENDING_PAYMENT
    DB-->>N: order id
    N-->>B: 201 Created
    B->>N: POST /api/v1/orders/{id}/pay-wallet (Idempotency-Key)
    N->>DB: transaction: buyer -gross -> ESCROW; listing SOLD; order PAID
    DB-->>N: commit (guarded UPDATE, không âm ví)
    N-->>B: 200 OK
    Note over N,S: giao hàng ngoài hệ thống; staff/carrier cập nhật DELIVERED
    N->>DB: transaction: ESCROW -gross -> seller +95%, PLATFORM_REVENUE +5%
    DB-->>N: commit; order COMPLETED
    N-->>S: số dư ví seller tăng
```

Bất biến của luồng: buyer không bao giờ âm ví; escrow chỉ chứa tiền thật đã nạp
vào; một món second-hand chỉ bán được một lần (trạng thái `SOLD` được cập nhật
trong cùng transaction với bút toán).

### 2.4.2. Nạp tiền qua PSP

1. Frontend gọi `POST /api/v1/wallet/topups` (⬜) - NestJS tạo payment intent,
   trả về QR/thông tin chuyển khoản (PayOS/VietQR).
2. Người dùng chuyển khoản; PSP gọi webhook `POST /api/v1/webhooks/payments/:provider`
   (⬜).
3. NestJS verify chữ ký trên payload thô, đọc số tiền **từ payload của PSP**
   (không tin client), gọi `BankingService.confirmDeposit()` với
   `gatewayRef` = mã giao dịch của PSP.
4. Ledger: `GATEWAY_CLEARING -a`, `user +a`. Webhook retry nhiều lần chỉ cộng
   tiền một lần nhờ idempotency key `deposit:{gatewayRef}` (đã có test chứng
   minh - replay 3 lần và race 3 luồng).

### 2.4.3. Rút tiền

1. Người dùng tạo `WithdrawalRequest` (⬜ endpoint; model đã có).
2. Staff duyệt: `user -a -> WITHDRAWAL_CLEARING` (tiền bị giữ ngay, chống rút
   hai lần trong lúc chờ ngân hàng).
3. Ngân hàng chuyển thành công: `WITHDRAWAL_CLEARING -a -> GATEWAY_CLEARING +a`
   (SETTLED). Thất bại: transfer đảo ngược đưa tiền về ví người dùng (FAILED).

### 2.4.4. Hoàn tiền / tranh chấp

Trong khi tiền còn ở escrow (đơn `PAID` → `DISPUTED`), hoàn tiền là
`ESCROW -g -> buyer +g`. Sau khi escrow đã release (đơn `COMPLETED`), hệ thống
**từ chối** hoàn tiền tự động - xử lý ngoài luồng bằng ADJUSTMENT có audit.

## 2.5. Thành phần và trạng thái triển khai

| Thành phần | Mô tả | Trạng thái |
| ---------- | ----- | ---------- |
| Ledger core (`LedgerService`) | Post/reverse transfer, guarded update, idempotency | ✅ |
| Banking flows (`BankingService`) | Deposit, pay, release, refund, withdrawal approve/settle/fail | ✅ |
| Database schema + guards | Bảng, constraint, trigger, view, RLS | ✅ |
| Test harness + 51 test | Unit + integration/e2e trên PostgreSQL thật | ✅ |
| HTTP API `/api/v1` + auth guard | Controller, ProblemDetail, phân quyền | ⬜ |
| Webhook PSP | Verify chữ ký PayOS/VietQR/Stripe | ⬜ |
| Scheduled jobs | Auto-release escrow, hết hạn giữ chỗ, đối soát định kỳ | ⬜ |
| Catalog/Listing/Order modules | Nghiệp vụ B2C + C2C đầy đủ | ⬜ |
| Frontend Next.js | Toàn bộ giao diện | ⬜ |
| Hạ tầng production | Supabase project, hosting, CI/CD | ⬜ |

## 2.6. Topology triển khai (mục tiêu)

| Môi trường | Frontend | Backend | Database |
| ---------- | -------- | ------- | -------- |
| Local dev | `next dev` | `nest start --watch` | PostgreSQL local (hoặc Supabase dev) |
| Staging | Vercel preview | Container host (Railway/Render/VPS) | Supabase project `staging` |
| Production | Vercel (domain chính) | Container host (≥ 2 instance, health check) | Supabase project `production` |

NestJS chạy dạng **long-running process** (không serverless) vì cần transaction
dài hơi với pool connection ổn định và scheduled jobs. Chi tiết xem
[../deployment/DEPLOYMENT.md](../../deployment/DEPLOYMENT.md).

## 2.7. Non-goals kiến trúc

- Không xây hệ thống ví theo mô hình sổ cái kép đầy đủ (double-entry chart of
  accounts) cho mọi nghiệp vụ; ledger hiện tại là mô hình transfer-leg đủ cho
  marketplace.
- Không cho phép client realtime subscribe vào bảng tài chính qua Supabase
  Realtime.
- Không microservices hóa ở giai đoạn này: một NestJS modular monolith là đơn
  vị triển khai duy nhất.

