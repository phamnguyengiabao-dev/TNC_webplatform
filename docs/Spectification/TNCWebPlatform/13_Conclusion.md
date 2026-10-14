# 13. Kết luận

## 13.1. Tổng kết

TNC Web Platform được định vị là nền tảng thương mại điện tử mỹ phẩm kết hợp
B2C (hàng mới) và C2C (hàng qua sử dụng, có escrow), xây trên
**Next.js + NestJS + Supabase**. Bộ tài liệu 00-14 đã bao phủ: bối cảnh, kiến
trúc, hạ tầng, database, backend, frontend, yêu cầu chức năng/phi chức năng,
use case, API, hướng dẫn sử dụng và phụ lục pháp lý.

Điểm khác biệt cốt lõi - **ví nội bộ + sổ cái bất biến + escrow** - không còn là
thiết kế trên giấy: tầng lõi đã được code và kiểm chứng.

## 13.2. Mức độ đáp ứng mục tiêu

| Objective | Phát biểu ngắn | Trạng thái | Bằng chứng |
| --------- | -------------- | ---------- | ---------- |
| Objective 1 | Mua B2C liền mạch, không oversell | ⬜ chưa có module catalog/order | Thiết kế tại 08, 10, 11 |
| Objective 2 | C2C an toàn hai chiều với escrow + duyệt tin | 🟨 escrow đã test; listing ⬜ | Test "escrow isolation", release/refund đúng trạng thái |
| Objective 3 | Dòng tiền minh bạch, drift = 0, không cộng tiền hai lần | ✅ (tầng service) | 51 test: replay ×3, race ×3, concurrency ×5, drift = 0 |
| Objective 4 | Kiểm soát vận hành + tuân thủ | 🟨 thiết kế + model; tầng HTTP/audit job ⬜ | Rà soát pháp lý 2026-10-14; workflow duyệt rút đã test |

## 13.3. Tài sản kỹ thuật hiện có (2026-10-14)

| Hạng mục | Chi tiết | Trạng thái |
| -------- | -------- | ---------- |
| Ledger core | `LedgerService` post/reverse/idempotency, guarded UPDATE, transfer-leg | ✅ |
| Banking flows | Deposit, pay, release, refund, withdrawal approve/settle/fail, statement, drift | ✅ |
| Database | Prisma schema + migration nhúng toàn bộ `finance_guards.sql` (constraint, trigger, view, RLS, seed ví hệ thống) | ✅ |
| Bất biến tiền tệ | Cân bằng transfer, append-only, ví không âm, whole-đồng - bảo vệ ở tầng DB | ✅ |
| Test suite | 17 unit + 34 integration/e2e trên PostgreSQL thật, harness tự dựng | ✅ 51/51 pass |
| Bộ tài liệu | 00-14 + database/api/deployment + sprint | ✅ (chương này) |
| HTTP API, webhook, jobs, catalog/listing/order modules, frontend, hạ tầng production | - | ⬜ theo lộ trình |

## 13.4. Hạn chế hiện tại

| # | Hạn chế | Ảnh hưởng | Giảm nhẹ |
| - | ------- | --------- | -------- |
| 1 | Chưa có tầng HTTP (controller, auth guard, ProblemDetail filter) | Chưa dùng được từ frontend | Sprint kế tiếp (xem `docs/SPRINT_SETUP_AND_ENDPOINT_TESTING.md`) |
| 2 | Chưa có webhook + job định kỳ | Nạp tiền/auto-release/đối soát chưa tự động end-to-end | Service đã sẵn; chỉ cần lớp vỏ |
| 3 | Module catalog/listing/order chưa có | Objective 1, 2 chưa chạy được | Thiết kế đầy đủ tại 08/10/11 |
| 4 | Frontend chưa có code | Chưa có giao diện | Đặc tả tại 07; phụ thuộc HTTP API |
| 5 | Chưa có kết luận pháp lý về mô hình ví/escrow | **Gate cho chức năng rút tiền** | NFR-24: ưu tiên mô hình không tự giữ tiền qua PSP có phép |
| 6 | Ba con số nghiệp vụ chưa được chốt | Hoa hồng 5%, giữ chỗ 10 phút, auto-release 3 ngày | Đánh dấu "mặc định tạm" xuyên suốt tài liệu |

## 13.5. Lộ trình ngắn hạn

| Mốc | Kết quả bàn giao | Phụ thuộc |
| --- | ---------------- | --------- |
| Sprint S1 | HTTP layer: auth guard JWKS, ProblemDetail filter, `/health`, `/me`, `/wallet`, `/wallet/statement` | Chương 11 mục 11.3, 11.4, 11.7 |
| Sprint S2 | Đơn hàng: `POST /orders`, `pay-wallet`, `cancel`, job hết hạn giữ chỗ + audit | Module order + job hạ tầng |
| Sprint S3 | Nạp tiền: topup intent + webhook verify chữ ký + replay an toàn | PSP sandbox (PayOS/VietQR) |
| Sprint S4 | Listing C2C + duyệt tin + khu vực staff (release/refund/withdraw UI) | Module listing + staff UI |
| Sprint S5 | Catalog B2C + flash sale + frontend catalog/checkout | Module catalog |
| Trước go-live | Rà soát pháp lý, chính sách đổi trả/hoàn tiền công khai, CI/CD, diễn tập restore | NFR-24..28, 12.11 |

## 13.6. Kết luận

Phần khó nhất của một nền tảng có yếu tố "ngân hàng" - tính đúng đắn của dòng
tiền - đã được giải quyết trước và được bảo vệ bằng chính database, không phụ
thuộc vào việc lập trình viên có nhớ hay không. Phần còn lại của dự án (HTTP,
webhook, jobs, catalog/listing/order, frontend) là công việc kỹ thuật có lộ
trình rõ ràng, mỗi bước đều đã có đặc tả trong bộ tài liệu này và sẽ tiếp tục
được cập nhật song song với code theo đúng quy ước trạng thái ✅/🟨/⬜.

Hai việc phải làm **trước tiên** trước mọi dòng code mới:

1. Chạy 2 câu diagnostic RLS trên Supabase project thật (xem
   `prisma/sql/finance_guards.sql`).
2. Chốt ba con số nghiệp vụ (hoa hồng, giữ chỗ, auto-release) và khởi động rà
   soát pháp lý cho mô hình ví/escrow (NFR-24).
