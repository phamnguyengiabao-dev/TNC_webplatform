# 03. Mục tiêu

## 3.1. Tổng quan

Bốn mục tiêu SMART của TNC Web Platform, suy ra trực tiếp từ mục đích sản phẩm
tại [01_Background.md](01_Background.md) mục 1.4.

| Objective | Phát biểu ngắn | Use case chính | Trạng thái |
| --------- | -------------- | -------------- | ---------- |
| Objective 1 | Bán mỹ phẩm mới (B2C) với đặt hàng - thanh toán đáng tin | UC-02, UC-03 | ⬜ (chưa có module catalog/order) |
| Objective 2 | Chợ second-hand an toàn hai chiều với escrow + duyệt tin đăng | UC-04, UC-06, UC-07, UC-08 | 🟨 (banking core đã có, chưa có module listing) |
| Objective 3 | Dòng tiền minh bạch: ví nội bộ, ledger bất biến, đối soát drift = 0 | UC-05, UC-06, UC-08, UC-09 | ✅ (ledger + banking đã có, đã test) |
| Objective 4 | Vận hành có kiểm soát và tuân thủ (audit, duyệt rút tiền, pháp lý) | UC-10 | 🟨 (bảng/model/thiết kế có, tầng vận hành chưa) |

Bảng liên kết giá trị mang lại với yêu cầu:

| Giá trị | Yêu cầu chức năng liên quan |
| ------- | --------------------------- |
| Mua sắm B2C liền mạch | FR-10 đến FR-16 |
| C2C an toàn (escrow, duyệt tin) | FR-17 đến FR-26, FR-31 đến FR-36 |
| Ví & dòng tiền minh bạch | FR-27 đến FR-30, FR-37 đến FR-40 |
| Vận hành, audit, tuân thủ | FR-41 đến FR-45 |

---

## 3.2. Objective 1: Khách hàng hoàn tất đặt mua mỹ phẩm mới (B2C) từ catalog đến thanh toán trong vòng 3 phút, với API p95 dưới 500 ms và tồn kho không bao giờ bán quá số lượng

- **S (cụ thể):** catalog + chi tiết sản phẩm + giỏ hàng + checkout thanh toán
  bằng ví, tồn kho cập nhật bằng guarded UPDATE.
- **M (đo được):** thời gian hoàn tất luồng mua ≤ 3 phút với người dùng phổ
  thông; p95 latency API catalog/checkout ≤ 500 ms; 0 oversell trong test đồng
  thời (N luồng mua, số lượng bán ra = tồn kho).
- **A (khả thi):** catalog đọc từ Postgres có index; checkout một transaction
  ngắn; ảnh phục vụ qua CDN Supabase Storage.
- **R (liên quan):** doanh thu B2C là nguồn tiền mặt chính của nền tảng.
- **T (thời hạn):** hoàn thành cùng sprint HTTP API + catalog (xem
  [../SPRINT_SETUP_AND_ENDPOINT_TESTING.md](../../SPRINT_SETUP_AND_ENDPOINT_TESTING.md)).

### 3.2.1. Tình huống sử dụng UC-02: Xem và chọn sản phẩm B2C

Khách duyệt catalog, lọc theo danh mục/giá, mở chi tiết sản phẩm. Trạng thái
tồn kho hiển thị theo thời gian thực từ API. Liên kết: UC-02, FR-10..FR-12.

### 3.2.2. Tình huống sử dụng UC-03: Đặt hàng và thanh toán B2C

Buyer tạo đơn (giữ chỗ tồn kho), thanh toán bằng ví trong thời hạn giữ chỗ;
quá hạn thì đơn hủy và tồn kho trả về. Thanh toán là một transaction duy nhất.
Liên kết: UC-03, FR-13..FR-16.

---

## 3.3. Objective 2: Người mua second-hand được bảo vệ bởi escrow - tiền chỉ đến tay người bán sau khi đơn được giao thành công; mọi tin đăng phải qua duyệt; một món chỉ bán được một lần

- **S:** luồng C2C: đăng bán → staff duyệt → buyer mua (tiền vào escrow) →
  giao hàng → release cho seller (trừ hoa hồng) hoặc refund cho buyer.
- **M:** 100% đơn C2C hoàn tất đi qua escrow (không có đường tắt cộng tiền
  trực tiếp cho seller); 0 tin đăng hiển thị khi chưa duyệt; 0 trường hợp một
  listing bán cho hai người (test đồng thời với số lượng 1).
- **A:** escrow + ledger đã xây và đã được test; phần còn lại là module
  listing/duyệt.
- **R:** niềm tin là yếu tố quyết định thị trường second-hand.
- **T:** sau khi HTTP API + auth hoàn tất.

### 3.3.1. Tình huống sử dụng UC-04: Mua mỹ phẩm second-hand (escrow)

Mô tả đầy đủ tại [10_Use_Cases.md](10_Use_Cases.md). Điểm đo: số dư buyer không
bao giờ âm; escrow của một đơn không bị đơn khác rút (đã có test
"escrow isolation"); release/refund chỉ chấp nhận đúng trạng thái đơn.

### 3.3.2. Tình huống sử dụng UC-06: Đăng bán second-hand và duyệt tin

Seller tạo tin kèm ảnh, tình trạng, hạn dùng; staff duyệt/từ chối có lý do;
audit ghi nhận cả hai phía. Liên kết: UC-06, FR-17..FR-21.

---

## 3.4. Objective 3: Mọi đồng tiền trong hệ thống nằm trên một sổ cái cân bằng tuyệt đối - đối soát tự động cho drift bằng 0, webhook retry không bao giờ cộng tiền hai lần

- **S:** mọi luồng tiền (nạp, thanh toán, release, refund, rút, hoa hồng) đều
  là `LedgerTransfer` cân bằng; số dư là projection có kiểm chứng.
- **M:**
  - `select sum(amount) from "LedgerEntry"` = 0 với mọi trạng thái hệ thống.
  - `WalletReconciliation.drift = 0` cho mọi ví sau khi chạy hết bộ test.
  - Webhook nạp tiền replay 3 lần (tuần tự và đồng thời) ⇒ cộng đúng một lần.
  - 5 request thanh toán đồng thời cùng một đơn ⇒ đúng một transaction tiền.
- **A/R:** tất cả tiêu chí trên **đã được chứng minh bằng test tự động** chạy
  thật (xem 06_Backend.md mục 6.7).
- **T:** đạt (✅) ngày 2026-10-14 cho tầng service; giữ vững khi thêm tầng HTTP
  (mọi endpoint tiền phải kế thừa idempotency).

### 3.4.1. Tình huống sử dụng UC-05: Nạp tiền vào ví

Repo đã có `BankingService.confirmDeposit()` với khoá idempotency
`deposit:{gatewayRef}`; phần còn thiếu là endpoint tạo top-up và webhook verify
chữ ký.

---

## 3.5. Objective 4: Vận hành có kiểm soát và tuân thủ - mọi thay đổi trạng thái nghiệp vụ đều có audit trail, lệnh rút tiền chỉ được chi khi nhân viên duyệt, hệ thống đáp ứng khung pháp lý về ví/escrow và thuế sàn TMĐT

- **S:** audit log đồng transaction với thay đổi; workflow duyệt rút tiền 2
  bước; báo cáo đối soát định kỳ.
- **M:**
  - 100% thay đổi trạng thái đơn/listing/lệnh rút sinh bản ghi `AuditLog`
    (kiểm tra bằng test approval workflow khi module hoàn tất).
  - 0 lệnh rút chi tiền khi chưa có duyệt (thiết kế: debit chỉ xảy ra ở bước
    approve).
  - Hồ sơ pháp lý: mô hình ví/escrow, nghĩa vụ thuế sàn - xem 09 và phụ lục.
- **A:** audit + workflow đã có thiết kế và model; cần hoàn thiện cùng staff UI.
- **T:** trước khi mở bán production.

---

## 3.6. Liên kết mục tiêu và use case

| Objective | Use case | Trạng thái kiểm chứng hiện tại |
| --------- | -------- | ------------------------------ |
| Objective 1 | UC-02, UC-03 | Chưa có code; thiết kế tại 10 và 11 |
| Objective 2 | UC-04, UC-06, UC-07, UC-08 | Ledger/escrow đã test; listing/duyệt là thiết kế |
| Objective 3 | UC-05, UC-08, UC-09, UC-10 | ✅ Test tự động: concurrency, replay, drift = 0 |
| Objective 4 | UC-10 (bao trùm audit của UC-06 và UC-08) | Thiết kế + model; audit tầng service là việc kế tiếp |

