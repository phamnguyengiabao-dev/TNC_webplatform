# 14. Phụ lục và tham chiếu

## 14.1. Quyết định kiến trúc (ADR)

| ID | Quyết định | Lý do chính | Hệ quả |
| -- | ---------- | ----------- | ------ |
| ADR-01 | Mọi thao tác tiền đi qua NestJS; frontend **không bao giờ** ghi tiền trực tiếp vào Postgres | Không tin client trong hệ thống tài chính; RLS mặc định đóng + `revoke all` cho `anon`/`authenticated` | Frontend chỉ có API; muốn mở bảng cho đọc công khai phải grant + policy tường minh, có review |
| ADR-02 | Ledger mô hình transfer-leg: mỗi giao dịch là `LedgerTransfer` gồm ≥ 2 leg có dấu, tổng = 0 | Chống tạo/hủy tiền do bug; đối soát đơn giản (`sum(amount) = 0`) | Deferred constraint trigger `assert_transfer_balanced` bắt buộc; mọi flow phải thiết kế đủ leg |
| ADR-03 | Số dư ví là **projection cache** của ledger, không phải nguồn sự thật | Ledger là bất biến, có thể replay/đối soát; cache giúp đọc nhanh | `Wallet.balance` chỉ được cập nhật bởi `LedgerService.post()` bằng guarded UPDATE; view `WalletReconciliation` phát hiện drift |
| ADR-04 | Ledger append-only; sửa sai bằng transfer đảo (`reverse()`), không UPDATE/DELETE | Lịch sử tài chính không được phép viết lại; audit trail đáng tin | Trigger chặn UPDATE/DELETE trên `LedgerEntry`; `LedgerTransfer` chỉ đổi được `status` |
| ADR-05 | Ví hệ thống: `ESCROW`, `PLATFORM_REVENUE`, `GATEWAY_CLEARING`, `WITHDRAWAL_CLEARING` | Tách rõ tiền của khách, tiền đang giữ hộ, tiền đã thu của nền tảng, tiền đang đối chiếu với PSP/ngân hàng | `GATEWAY_CLEARING`/`WITHDRAWAL_CLEARING` được phép âm (phản ánh dòng tiền vào/ra hệ thống); USER/ESCROW không bao giờ âm |
| ADR-06 | Tiền là `NUMERIC(18,2)` + `Prisma.Decimal`; API trả **chuỗi** | JS `number` mất chính xác; VND không có phần lẻ | CHECK `ledger_entry_whole_dong`; frontend không parse để tính |
| ADR-07 | Idempotency hai tầng: unique key trên `LedgerTransfer` (bắt buộc) + `IdempotencyRecord` cho POST không sinh transfer | Webhook retry/double-click là chuyện bình thường; DB quyết định thắng thua thay vì code race | Mọi endpoint tiền phải nhận `Idempotency-Key`; replay trả kết quả cũ |
| ADR-08 | "Tiền đang chờ" không nằm trong ledger | Ledger chỉ ghi cái đã thực sự xảy ra; trạng thái ý định nằm trên `Order`/`WithdrawalRequest` | Ví dụ: lệnh rút chỉ debit khi approve; đơn `PENDING_PAYMENT` không sinh bút toán |
| ADR-09 | Backend chạy dạng **long-running container**, không serverless | Cần transaction ổn định với pool nhỏ của Supabase và scheduled jobs (auto-release, đối soát) | Container host (Railway/Render/VPS); advisory lock khi scale ngang |
| ADR-10 | Escrow dùng chung một ví, nhưng release/refund đối chiếu **theo từng đơn** (`assertEscrowHolds`) | Kiểm tra số dư tổng không chặn được đơn A rút tiền của đơn B | Query sum leg theo `orderId` trước mỗi release/refund; có test "escrow isolation" |
| ADR-11 | Tài liệu tiếng Việt, identifier/contract tiếng Anh; mỗi hạng mục gắn trạng thái ✅/🟨/⬜ | Tài liệu và code cùng tiến hóa; người đọc phân biệt ngay cái gì đã có | Quy ước tại `docs/README.md`; PR đổi hành vi phải cập nhật tài liệu |

## 14.2. Giả định và số liệu chờ chốt

| # | Giả định / số liệu | Giá trị đang dùng | Nguồn | Trạng thái |
| - | ------------------ | ----------------- | ----- | ---------- |
| 1 | Hoa hồng nền tảng | `APP_COMMISSION_BPS = 500` (5,00%) | `src/config/configuration.ts` | **Mặc định tạm - cần chủ dự án chốt** |
| 2 | Thời gian giữ chỗ đơn | `APP_RESERVATION_MINUTES = 10` phút | 06 mục 6.10 (job ⬜ tương ứng) | **Cần chốt** |
| 3 | Auto-release escrow sau DELIVERED | `APP_AUTO_RELEASE_DAYS = 3` ngày | 06 mục 6.10 (job ⬜) | **Đề xuất - cần chốt** |
| 4 | Giới hạn ảnh listing | ≤ 10 ảnh, ≤ 5 MB/ảnh | 04 mục 4.2.3 | Mặc định tạm |
| 5 | Thời hạn top-up QR | ~15 phút | 10 UC-05, 11.7.3 | Phụ thuộc PSP - cần chốt |
| 6 | Hạn mức rút tiền mỗi lệnh/ngày | chưa có | 10 UC-10 | **Cần chốt trước go-live** |
| 7 | Thời hạn lưu trữ dữ liệu giao dịch | đề xuất 10 năm | 09 NFR-27 | Cần kế toán/luật sư xác nhận |
| 8 | SLA xử lý rút tiền | trong ngày làm việc | 12.6 | Cần chốt |
| 9 | Đa tiền tệ / đa ngôn ngữ | Không (chỉ VND, tiếng Việt) | 01 mục 1.6 | Trong scope 0.1 |
| 10 | PSP sử dụng | PayOS/VietQR; Stripe dự phòng | 04 mục 4.1 | Chưa tích hợp |

## 14.3. Thuật ngữ

| Thuật ngữ | Giải thích |
| --------- | ---------- |
| Adjustment | Transfer điều chỉnh ngoại lệ, chỉ ADMIN tạo, có lý do + audit |
| B2C / C2C | Bán hàng mới cho khách lẻ / người dùng bán cho người dùng |
| Commission | Hoa hồng nền tảng, chốt tại checkout, lưu trên `Order.commissionAmount` |
| Drift | Chênh lệch giữa `Wallet.balance` và tổng ledger; mục tiêu luôn = 0 |
| Escrow | Ví trung gian giữ tiền người mua đến khi đơn hoàn tất |
| Gateway clearing | Ví hệ thống đối chiếu dòng tiền ra/vào qua PSP/ngân hàng |
| Guarded UPDATE | Câu UPDATE có điều kiện (`WHERE ... AND balance + delta >= 0`) - kiểm tra và ghi trong cùng một statement |
| Idempotency key | Khoá chống xử lý trùng; unique ở DB quyết định thắng thua |
| JWT / JWKS | Token Supabase phát hành / bộ khoá công khai để backend verify chữ ký |
| Ledger | Sổ cái bất biến: transfer + các leg có dấu tổng = 0 |
| Leg | Một dòng `LedgerEntry` (amount có dấu) thuộc một transfer |
| ProblemDetail | Định dạng lỗi RFC 7807 + trường `code` ổn định |
| Projection | Dữ liệu dẫn xuất (số dư ví cache) từ nguồn sự thật (ledger) |
| RLS | Row Level Security của PostgreSQL/Supabase |
| Transfer | Một giao dịch tiền gồm ≥ 2 leg cân bằng |
| Whole đồng | Số tiền VND nguyên đồng, không có phần lẻ |

## 14.4. Tham chiếu pháp lý

Đã kiểm chứng ngày 2026-10-14 (nguồn chi tiết tại
[../banking-design-review.md](../../banking-design-review.md) mục S12):

| Văn bản | Liên quan đến |
| ------- | ------------- |
| Nghị định 52/2024/NĐ-CP (hiệu lực 01/7/2024) - [chinhphu.vn](https://chinhphu.vn/?classid=0&docid=210262&pageid=27160) | Dịch vụ ví điện tử/thu hộ-chi hộ/cổng thanh toán phải được NHNN cấp phép; tỷ lệ đảm bảo 1:1 |
| Luật Thương mại điện tử 122/2025/QH15 (hiệu lực 01/7/2026) - [congbao.chinhphu.vn](https://congbao.chinhphu.vn/van-ban/luat-so-122-2025-qh15-468683.htm) | Nghĩa vụ sàn có chức năng đặt hàng: chính sách đổi trả/hoàn tiền, công khai đơn vị thanh toán, xử lý khiếu nại |
| Nghị định 248/2026/NĐ-CP (30/6/2026) - [chinhphu.vn](https://chinhphu.vn/?classid=0&docid=218747&pageid=27160) | Quy định chi tiết thi hành Luật TMĐT |
| Nghị định 117/2025/NĐ-CP - [vbpl.vn](https://vbpl.vn/TW/Pages/vbpq-toanvan.aspx?ItemID=178299) | Khấu trừ, nộp thay thuế của nền tảng có chức năng đặt hàng/thanh toán |
| Nghị định 13/2023/NĐ-CP | Bảo vệ dữ liệu cá nhân (rà soát khi go-live - NFR-28) |

> Ghi chú: đây là tài liệu kỹ thuật, không phải tư vấn pháp lý. Cần luật sư xác
> nhận trước khi mở chức năng rút tiền và trước khi vận hành thật.

## 14.5. Tham chiếu kỹ thuật

| Nguồn | Dùng cho |
| ----- | -------- |
| [Supabase - Tables not exposed to API automatically (changelog)](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically) | Thay đổi mặc định 30/5/2026 (project mới) và 30/10/2026 (toàn bộ) - lý do phải grant + RLS tường minh |
| [Supabase - Tables & API security](https://supabase.com/docs/guides/database/tables), [Securing your API](https://supabase.com/docs/guides/api/securing-your-api) | RLS, grants, default privileges |
| [RFC 7807](https://www.rfc-editor.org/rfc/rfc7807) | Định dạng ProblemDetail |
| [RFC 3339](https://www.rfc-editor.org/rfc/rfc3339) | Định dạng thời gian ISO-8601 |
| Prisma 6 documentation (pin `6.19.3`) | Schema, migration, `$transaction` |

## 14.6. Sơ đồ luồng tiền tóm tắt

```text
Nạp tiền:        GATEWAY_CLEARING -a   user +a
Thanh toán:      buyer -g              ESCROW +g
Release C2C:     ESCROW -g             seller +(g-c)   PLATFORM_REVENUE +c
Release B2C:     ESCROW -g             PLATFORM_REVENUE +g
Hoàn tiền:       ESCROW -g             buyer +g
Duyệt rút:       user -a               WITHDRAWAL_CLEARING +a
Settle rút:      WITHDRAWAL_CLEARING -a  GATEWAY_CLEARING +a
Sai sót:         transfer đảo = ảnh gương âm của từng leg gốc
```

Bất biến toàn cục: `select sum(amount) from "LedgerEntry"` = 0 tại mọi thời
điểm (được deferred trigger bảo vệ ở COMMIT).

## 14.7. Lịch sử thay đổi tài liệu

| Ngày | Phiên bản | Thay đổi |
| ---- | --------- | -------- |
| 2026-10-14 | 0.1 | Bản thảo đầu tiên: 00-14, database/api/deployment, sprint; phản ánh hiện trạng repo (banking core + 51 test ✅) |

