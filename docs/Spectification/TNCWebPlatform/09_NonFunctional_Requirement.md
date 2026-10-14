# 09. Yêu cầu phi chức năng

## 9.1. Tổng quan

Yêu cầu phi chức năng (NFR) quy định *chất lượng* mà hệ thống phải đạt: hiệu
năng, độ tin cậy, bảo mật, tuân thủ pháp lý, khả năng bảo trì và vận hành. Mỗi
yêu cầu có ID, mức ưu tiên và trạng thái theo quy ước tại
[README.md](../../README.md) (✅ Đã có - 🟨 Một phần - ⬜ Kế hoạch).

Phần lớn các bảo đảm về **tính đúng đắn của tiền** (cân bằng, bất biến, không
âm, idempotent) không chỉ là NFR ước nguyện - chúng đã được thực thi ở tầng
database và **chứng minh bằng 51 test tự động** (xem
[06_Backend.md](06_Backend.md) mục 6.11). Các NFR đó được đánh dấu ✅ tương ứng.

## 9.2. Hiệu năng

| ID | Yêu cầu | Mục tiêu | Độ ưu tiên | Trạng thái |
| -- | ------- | -------- | ---------- | ---------- |
| NFR-01 | Độ trễ API đọc (catalog, chi tiết sản phẩm, ví, sổ giao dịch) | p95 ≤ 500 ms ở tải thường; p99 ≤ 1.500 ms | Bắt buộc | ⬜ (chưa có HTTP layer) |
| NFR-02 | Độ trễ API ghi tiền (thanh toán, release, duyệt rút) | p95 ≤ 1.000 ms, **không tính** thời gian chờ PSP/ngân hàng (mọi call ngoài nằm ngoài transaction) | Bắt buộc | 🟨 (service đã có; số đo khi có HTTP) |
| NFR-03 | Trang catalog đạt Core Web Vitals | LCP < 2,5 s trên 4G, CLS < 0,1, INP < 200 ms (SSR/ISR + next/image) | Nên làm | ⬜ |
| NFR-04 | Transaction tiền phải ngắn và bị giới hạn thời gian | timeout 15 s, maxWait 5 s (đã cấu hình trong code); cấm HTTP/PSP bên trong `$transaction` | Bắt buộc | ✅ (code + review) |
| NFR-05 | Webhook PSP phải trả 2xx nhanh | ≤ 2 s sau khi verify chữ ký; xử lý nặng đẩy sang job (retry của PSP chỉ là replay idempotent) | Bắt buộc | ⬜ |
| NFR-06 | Phân trang đọc dữ liệu | Cursor keyset, `take` tối đa 100; không dùng OFFSET sâu (sổ giao dịch, đơn hàng) | Bắt buộc | 🟨 (`getStatement` ✅; HTTP ⬜) |
| NFR-07 | Ảnh qua CDN | Ảnh gốc ≤ 5 MB, tối đa 10 ảnh/listing (mặc định tạm - cần chốt); phục vụ qua CDN Supabase Storage + `next/image` | Bắt buộc | ⬜ |

## 9.3. Độ tin cậy và tính sẵn sàng

| ID | Yêu cầu | Mục tiêu | Độ ưu tiên | Trạng thái |
| -- | ------- | -------- | ---------- | ---------- |
| NFR-08 | Mọi thao tác tiền phải idempotent | Cùng một sự kiện (webhook retry, double-click) chỉ tạo **một** transfer; replay trả kết quả cũ, không lỗi | Bắt buộc | ✅ (test replay ×3, race ×3, 5 request đồng thời ⇒ 1 thắng) |
| NFR-09 | Không bán quá tồn kho / không bán một món hai lần | 0 oversell B2C; listing C2C (`qty = 1`) không thể bán cho hai người dù đồng thời | Bắt buộc | 🟨 (cơ chế guarded UPDATE ✅ trong banking; module tồn kho ⬜) |
| NFR-10 | Số dư cache phải luôn khớp ledger | `WalletReconciliation.drift = 0` cho mọi ví; `LedgerIntegrity.total_drift = 0` toàn hệ thống | Bắt buộc | ✅ (test sau toàn bộ luồng) |
| NFR-11 | Phát hiện lệch chủ động | Job đối soát mỗi giờ đọc hai view trên; drift ≠ 0 ⇒ **cảnh báo, không tự sửa** | Bắt buộc | 🟨 (`findBalanceDrift()` ✅; job ⬜) |
| NFR-12 | Tính sẵn sàng API production | ≥ 99,5%/tháng (không tính bảo trì có kế hoạch); scale ngang ≥ 2 instance backend | Nên làm | ⬜ |
| NFR-13 | Sao lưu và khôi phục | Tối thiểu daily backup giữ 7 ngày; ưu tiên PITR; RPO ≤ 24 h (≤ 5 phút nếu có PITR), RTO ≤ 4 h | Bắt buộc | ⬜ (phụ thuộc gói Supabase) |
| NFR-14 | Scheduled job đúng hạn, không chạy trùng | Hết hạn giữ chỗ xử lý trong ≤ 1 phút; auto-release/đối soát trong ≤ 1 giờ sau mốc; dùng advisory lock khi scale ngang | Bắt buộc | ⬜ |

## 9.4. Bảo mật và quyền riêng tư

| ID | Yêu cầu | Mục tiêu | Độ ưu tiên | Trạng thái |
| -- | ------- | -------- | ---------- | ---------- |
| NFR-15 | Xác thực JWT đúng chuẩn | Backend verify chữ ký qua JWKS của Supabase (ES256/RS256), kiểm tra `exp`/`aud`; **không** tự parse token | Bắt buộc | ⬜ |
| NFR-16 | Phân quyền lấy từ database | Role đọc từ `UserProfile.role`, không tin client claim; endpoint staff/admin từ chối 403 nếu thiếu quyền; tài khoản `isBlocked` không thao tác tiền | Bắt buộc | ⬜ |
| NFR-17 | Bảng tài chính mặc định đóng với frontend | RLS bật + 0 policy + `revoke all` cho `anon`/`authenticated` + chặn default privileges; chỉ backend (owner) truy cập | Bắt buộc | ✅ (đã nhúng trong migration; cần chạy diagnostic trên Supabase thật) |
| NFR-18 | Không rò rỉ dữ liệu nhạy cảm | Không log/tra về: số dư trong message lỗi, số tài khoản đầy đủ, payload PSP, token; số tài khoản chỉ hiển thị dạng che (`****1234`) | Bắt buộc | 🟨 (che số tài khoản ✅ trong model; quy tắc log ⬜) |
| NFR-19 | Bảo vệ đường truyền | HTTPS bắt buộc mọi môi trường thật; CORS allowlist theo origin; service role key chỉ nằm ở backend | Bắt buộc | ⬜ |
| NFR-20 | Chống race/oversell ở tầng sâu nhất | Guarded UPDATE + deferred balance trigger + CHECK constraints; bug ở code không thể tạo/hủy tiền | Bắt buộc | ✅ (test trực tiếp trên PostgreSQL) |
| NFR-21 | Audit trail bất biến | `AuditLog` chỉ được insert; 100% thay đổi trạng thái nghiệp vụ ghi **cùng transaction** với thay đổi | Bắt buộc | ⬜ (bảng ✅, aspect ⬜) |
| NFR-22 | Chống lạm dụng endpoint nhạy cảm | Rate limit cho login/topup/withdrawal/webhook; chống brute force | Nên làm | ⬜ |
| NFR-23 | Webhook chống giả mạo và replay | Verify chữ ký trên **raw body** trước khi parse; sai chữ ký ⇒ 401; chỉ tin số tiền từ payload đã verify | Bắt buộc | ⬜ |

## 9.5. Tuân thủ pháp lý (thị trường Việt Nam)

> Mục này ghi nhận **ràng buộc pháp lý đã được kiểm chứng ngày 2026-10-14**
> (chi tiết tại [../banking-design-review.md](../../banking-design-review.md) mục
> S12). Đây không phải tư vấn pháp lý - phải xác nhận với luật sư trước khi mở
> các chức năng liên quan tiền thật.

| ID | Yêu cầu | Nội dung và ràng buộc | Độ ưu tiên | Trạng thái |
| -- | ------- | --------------------- | ---------- | ---------- |
| NFR-24 | Mô hình giữ tiền phải hợp pháp | Nghị định 52/2024/NĐ-CP (hiệu lực 01/7/2024): ví điện tử, thu hộ/chi hộ, cổng thanh toán là dịch vụ trung gian thanh toán **phải được NHNN cấp phép**; ví điện tử phải đảm bảo tổng số dư tài khoản đảm bảo ≥ tổng số dư ví khách (1:1). **Gate:** chỉ mở chức năng rút tiền cho người bán khi có kết luận pháp lý. Phương án ưu tiên: **không tự giữ tiền** - dùng PSP có phép (PayOS/VNPay/MoMo...) với escrow/payout; `Wallet` + ledger là sổ nội bộ phản chiếu `GATEWAY_CLEARING`/`WITHDRAWAL_CLEARING` | Bắt buộc | ⬜ (chờ rà soát pháp lý) |
| NFR-25 | Nghĩa vụ của sàn có chức năng đặt hàng | Luật Thương mại điện tử 122/2025/QH15 (hiệu lực 01/7/2026) + Nghị định 248/2026/NĐ-CP (30/6/2026): công bố và thực hiện đúng chính sách đổi trả/hoàn tiền; công khai tổ chức cung ứng dịch vụ thanh toán mà sàn hợp tác và cho người mua lựa chọn; tiếp nhận, xử lý khiếu nại. Luồng escrow/refund + `AuditLog` là hạ tầng cho các nghĩa vụ này | Bắt buộc | 🟨 (hạ tầng escrow/audit có; trang chính sách, kênh khiếu nại ⬜) |
| NFR-26 | Thuế sàn TMĐT | Nghị định 117/2025/NĐ-CP: nền tảng có chức năng đặt hàng và thanh toán phải khấu trừ, nộp thay thuế cho hộ/cá nhân kinh doanh. Cần báo cáo doanh thu/hoa hồng theo kỳ (FR-45) và tính toán phần thuế vào thiết kế hoá đơn giai đoạn sau | Bắt buộc | ⬜ |
| NFR-27 | Lưu trữ dữ liệu giao dịch | Dữ liệu ledger/audit/đơn hàng lưu trữ theo thời hạn kế toán - thuế hiện hành (đề xuất thiết kế: 10 năm - cần kế toán xác nhận); ledger append-only đáp ứng tự nhiên | Bắt buộc | 🟨 (thiết kế đáp ứng; chính sách lưu trữ chưa viết) |
| NFR-28 | Dữ liệu cá nhân | Tuân thủ quy định bảo vệ dữ liệu cá nhân (Nghị định 13/2023/NĐ-CP): có điều khoản sử dụng/chính sách bảo mật công khai, đồng ý khi đăng ký, tối thiểu hoá dữ liệu thu thập, quy trình xử lý yêu cầu xoá/đối soát của người dùng (đối chiếu phần pháp lý khi go-live) | Bắt buộc | ⬜ |

## 9.6. Khả năng bảo trì và mở rộng

| ID | Yêu cầu | Mục tiêu | Độ ưu tiên | Trạng thái |
| -- | ------- | -------- | ---------- | ---------- |
| NFR-29 | Migration là nguồn duy nhất của schema | Không sửa tay bằng SQL editor trên môi trường thật; migration forward-only; sửa `finance_guards.sql` phải đi kèm migration | Bắt buộc | ✅ (đang thực hiện) |
| NFR-30 | Test bắt buộc cho thay đổi hành vi tiền | Mọi PR đụng logic tiền phải bổ sung/cập nhật test; CI chạy `npm test` (unit + e2e trên PostgreSQL thật) | Bắt buộc | ✅ (51 test hiện có) |
| NFR-31 | Cấu hình theo 12-factor | Toàn bộ cấu hình qua env; không secret trong repo; `.env.example` là hợp đồng cấu hình | Bắt buộc | 🟨 |
| NFR-32 | An toàn kiểu cho tiền | Tiền là `Prisma.Decimal`/chuỗi, cấm `number`/`float`; TypeScript strict, typecheck trong CI | Bắt buộc | ✅ (quy tắc đã áp dụng; CI ⬜) |
| NFR-33 | Tài liệu là một phần deliverable | Thay đổi hành vi/API cập nhật chương tài liệu tương ứng trong cùng PR; tài liệu giữ trạng thái ✅/🟨/⬜ trung thực | Nên làm | 🟨 |
| NFR-34 | Nền tảng ổn định, nâng cấp có kiểm soát | Node ≥ 22; pin `prisma`/`@prisma/client` 6.19.3; nâng major version theo migration guide + test đầy đủ | Nên làm | ✅ (đang pin) |

## 9.7. Vận hành và giám sát

| ID | Yêu cầu | Mục tiêu | Độ ưu tiên | Trạng thái |
| -- | ------- | -------- | ---------- | ---------- |
| NFR-35 | Log có cấu trúc | JSON ra stdout; log mọi nghiệp vụ tiền kèm `transferId`/`idempotencyKey`; correlation id `X-Request-Id` xuyên request | Bắt buộc | ⬜ (chưa có HTTP layer) |
| NFR-36 | Cảnh báo bắt buộc | Drift ≠ 0; transfer vi phạm cân bằng (DB trigger nổ); webhook verify fail liên tục; tỷ lệ thanh toán lỗi tăng; job không chạy quá 2 chu kỳ | Bắt buộc | ⬜ |
| NFR-37 | Health check | `GET /health` (process) và `GET /health/db` (ping database + trạng thái migration head); container host ping 30 s | Bắt buộc | ⬜ |
| NFR-38 | Runbook sự cố | Quy trình: restore PITR → chạy diagnostic RLS → `prisma migrate status` → `WalletReconciliation`; ghi incident log tại `docs/` | Bắt buộc | 🟨 (quy trình ghi tại 04; chưa diễn tập) |

## 9.8. Khả dụng và tiếp cận

| ID | Yêu cầu | Mục tiêu | Độ ưu tiên | Trạng thái |
| -- | ------- | -------- | ---------- | ---------- |
| NFR-39 | Responsive, mobile-first | Hỗ trợ tốt từ 360 px; 2 phiên bản gần nhất của Chrome/Edge/Firefox/Safari; UI tiếng Việt | Bắt buộc | ⬜ |
| NFR-40 | Tiếp cận mức cơ bản (WCAG 2.1 AA) | Tương phản ≥ 4,5:1 cho chữ thường; điều hướng bàn phím; focus ring; label cho mọi form; trạng thái lỗi đọc được bằng screen reader | Nên làm | ⬜ |
| NFR-41 | Trạng thái màn hình đầy đủ | Mọi màn hình có API phải có loading (skeleton), empty (CTA), error (thông điệp tiếng Việt map từ `code` + nút thử lại) | Bắt buộc | ⬜ |

## 9.9. Ma trận truy vết NFR

| NFR | Objective | Use case / FR liên quan | Bằng chứng hiện có |
| --- | --------- | ----------------------- | ------------------ |
| NFR-01..07 | Objective 1 | UC-02, UC-03; FR-05..FR-15 | Chưa (HTTP layer ⬜) |
| NFR-08, 10, 20 | Objective 3 | FR-28..FR-33 | 51 test: replay ×3, race ×3, drift = 0, guards DB |
| NFR-09 | Objective 2 | FR-08, FR-20, FR-23 | Cơ chế guarded UPDATE trong banking; module tồn kho ⬜ |
| NFR-11, 14 | Objective 3, 4 | FR-33, FR-43 | `findBalanceDrift()` ✅; job ⬜ |
| NFR-12, 13 | Mọi objective | Vận hành | Chính sách ghi tại 04; chưa diễn tập |
| NFR-15..23 | Objective 4 | UC-01, UC-10; FR-01..04, FR-38, FR-42, FR-44 | RLS/revoke ✅ trong migration; còn lại ⬜ |
| NFR-24..28 | Objective 4 | NFR-25..28 gắn FR-39..45 | Rà soát pháp lý 2026-10-14 (nguồn ở mục 9.5); chưa có kết luận chính thức |
| NFR-29..34 | Mọi objective | Toàn hệ thống | Quy trình đang áp dụng |
| NFR-35..38 | Mọi objective | Vận hành | Thiết kế tại 04 mục 4.7 |
| NFR-39..41 | Objective 1, 2 | UC-02..UC-04; FR-05, FR-06 | Thiết kế tại 07 mục 7.6 |

## 9.10. Việc còn lại theo thứ tự ưu tiên

| # | Việc | Liên quan |
| - | ---- | --------- |
| 1 | Chạy 2 câu diagnostic RLS trên Supabase project thật (trích trong `prisma/sql/finance_guards.sql`) trước mọi việc khác | NFR-17 |
| 2 | HTTP layer: auth guard JWKS, ProblemDetail filter, correlation id, health | NFR-15, 16, 35, 37 |
| 3 | Webhook verify chữ ký + rate limit + log an toàn | NFR-05, 22, 23 |
| 4 | Scheduled jobs: hết hạn giữ chỗ, auto-release, đối soát drift + alert | NFR-11, 14, 36 |
| 5 | Audit aspect ghi `AuditLog` cùng transaction | NFR-21 |
| 6 | Rà soát pháp lý mô hình ví/escrow + chính sách đổi trả/hoàn tiền + thuế sàn | NFR-24..28 |
| 7 | CI/CD đầy đủ (typecheck, test, migrate, build) | NFR-30, 32 |

