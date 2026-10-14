> ⚠️ **REVISION 2026-10-14 — mô hình bán hàng đã đổi sang Shopee.** Showroom không xử lý thanh toán; nút mua deep-link sang gian hàng Shopee; backend tập trung **đồng bộ dữ liệu mặt hàng với Shopee**. Các nội dung wallet/escrow/orders/payment trong tài liệu này thuộc mô hình cũ — thay thế bởi [SHOPEE_SHOWROOM_BACKEND.md](../../backend/SHOPEE_SHOWROOM_BACKEND.md).

# 08. Yêu cầu chức năng

## 8.1. Tổng quan

Yêu cầu chức năng của TNC Web Platform chia theo 8 nhóm, đánh số FR-01 đến
FR-45. Cột trạng thái theo quy ước tại [README.md](../../README.md).

Use case tham chiếu: [10_Use_Cases.md](10_Use_Cases.md).

## 8.2. Nhóm 1 - Danh tính và truy cập

| ID | Yêu cầu chức năng | Use case | Độ ưu tiên | Trạng thái |
| -- | ----------------- | -------- | ---------- | ---------- |
| FR-01 | Hệ thống phải cho phép đăng ký/đăng nhập bằng email + mật khẩu và OAuth (Google, Facebook) qua Supabase Auth; tài khoản mới tự động được tạo `UserProfile` và ví VND | UC-01 | Bắt buộc | 🟨 (trigger schema ✅; cấu hình Auth ⬜) |
| FR-02 | Mọi API nghiệp vụ phải yêu cầu JWT hợp lệ; backend verify chữ ký qua JWKS của Supabase, không tự parse token | UC-01 | Bắt buộc | ⬜ |
| FR-03 | Phân quyền theo `UserProfile.role` (USER/STAFF/ADMIN); role đọc từ database, không tin claim phía client | UC-01, UC-10 | Bắt buộc | ⬜ |
| FR-04 | Tài khoản bị `isBlocked` không được tạo giao dịch tiền (nạp, thanh toán, rút) nhưng vẫn xem được lịch sử | UC-01 | Nên làm | ⬜ |

## 8.3. Nhóm 2 - Catalog và sản phẩm

| ID | Yêu cầu chức năng | Use case | Độ ưu tiên | Trạng thái |
| -- | ----------------- | -------- | ---------- | ---------- |
| FR-05 | Guest phải xem được catalog gồm sản phẩm B2C và listing C2C đã duyệt; lọc theo loại, danh mục, khoảng giá, tình trạng; phân trang giới hạn page size | UC-02 | Bắt buộc | ⬜ |
| FR-06 | Chi tiết sản phẩm phải hiển thị giá, tồn kho khả dụng, mô tả, ảnh (CDN); với C2C thêm % đã dùng, hạn dùng còn lại, ảnh chứng minh | UC-02 | Bắt buộc | ⬜ |
| FR-07 | Hệ thống phải hỗ trợ flash sale theo sản phẩm và khung giờ; giá sale hiển thị công khai nhưng tồn kho vẫn được bảo vệ bằng guarded update | UC-02, UC-03 | Nên làm | ⬜ |
| FR-08 | Tồn kho B2C chỉ được trừ bằng câu UPDATE có điều kiện (`WHERE stock >= qty`); không bao giờ bán quá tồn kho dù N người mua đồng thời | UC-03 | Bắt buộc | ⬜ |
| FR-09 | Ảnh sản phẩm/listing lưu trên Supabase Storage, phục vụ qua CDN; giới hạn mặc định 10 ảnh/listing, 5 MB/ảnh; backend quyết định đường dẫn lưu | UC-06 | Bắt buộc | ⬜ |

## 8.4. Nhóm 3 - Đơn hàng và thanh toán B2C

| ID | Yêu cầu chức năng | Use case | Độ ưu tiên | Trạng thái |
| -- | ----------------- | -------- | ---------- | ---------- |
| FR-10 | Tạo đơn phải yêu cầu đăng nhập và header `Idempotency-Key`; đơn mới ở `PENDING_PAYMENT` kèm giữ chỗ tồn kho theo `APP_RESERVATION_MINUTES` | UC-03 | Bắt buộc | ⬜ |
| FR-11 | Đơn quá hạn giữ chỗ phải tự động hủy và trả tồn kho (scheduled job, có audit) | UC-03 | Bắt buộc | ⬜ |
| FR-12 | Thanh toán đơn bằng ví phải là một transaction duy nhất: chỉ thành công khi ví đủ tiền, tiền vào ESCROW; thất bại rollback toàn bộ | UC-03, UC-04 | Bắt buộc | 🟨 (service ✅ + test; endpoint ⬜) |
| FR-13 | Hoa hồng nền tảng phải được chốt tại checkout và lưu trên đơn; đổi tỷ lệ sau này không ảnh hưởng đơn cũ | UC-03 | Bắt buộc | 🟨 (`quoteOrder` ✅; lưu khi tạo đơn ⬜) |
| FR-14 | Buyer phải hủy được đơn khi còn `PENDING_PAYMENT`; thao tác trả tồn kho và có audit | UC-03 | Nên làm | ⬜ |
| FR-15 | Staff phải cập nhật được trạng thái giao vận `READY_TO_SHIP → SHIPPED → DELIVERED`; mọi chuyển trạng thái có audit | UC-07 | Bắt buộc | ⬜ |

## 8.5. Nhóm 4 - Tin đăng second-hand và quy trình duyệt

| ID | Yêu cầu chức năng | Use case | Độ ưu tiên | Trạng thái |
| -- | ----------------- | -------- | ---------- | ---------- |
| FR-16 | Seller phải tạo được listing với các trường bắt buộc: sản phẩm, giá, % đã dùng, hạn dùng còn lại, mô tả, ảnh, ảnh chứng minh mua hàng | UC-06 | Bắt buộc | ⬜ |
| FR-17 | Mọi listing mới phải ở trạng thái chờ duyệt; không hiển thị công khai trước khi staff duyệt | UC-06 | Bắt buộc | ⬜ |
| FR-18 | Staff phải duyệt hoặc từ chối listing (từ chối bắt buộc lý do); cả hai hành động đều ghi audit | UC-06 | Bắt buộc | ⬜ |
| FR-19 | Seller phải sửa và gửi lại được listing bị từ chối; listing đã duyệt muốn sửa nội dung phải qua duyệt lại | UC-06 | Bắt buộc | ⬜ |
| FR-20 | Listing phải tự ẩn khỏi catalog ngay khi được bán (`SOLD`) hoặc bị staff ẩn; không ai mua được listing SOLD | UC-04, UC-06 | Bắt buộc | ⬜ |
| FR-21 | Số lượng listing C2C luôn là 1; hệ thống phải chặn mọi trường hợp một listing bán cho hai người | UC-04 | Bắt buộc | ⬜ |
| FR-22 | Listing bị từ chối/ẩn phải hiển thị lý do cho chính seller | UC-06 | Nên làm | ⬜ |

## 8.6. Nhóm 5 - Mua second-hand và vòng đời escrow

| ID | Yêu cầu chức năng | Use case | Độ ưu tiên | Trạng thái |
| -- | ----------------- | -------- | ---------- | ---------- |
| FR-23 | Mua listing C2C phải là một transaction: ví buyer trừ tiền → ESCROW + tiền; listing chuyển `SOLD`; đơn `PAID` | UC-04 | Bắt buộc | 🟨 (service ✅ + test; endpoint/listing ⬜) |
| FR-24 | Tiền trong escrow chỉ được release cho seller khi đơn ở `DELIVERED`; release chia đúng hoa hồng đã chốt | UC-08 | Bắt buộc | ✅ |
| FR-25 | Auto-release escrow sau `APP_AUTO_RELEASE_DAYS` ngày kể từ `DELIVERED` nếu buyer không mở tranh chấp (mặc định đề xuất 3 ngày - cần chốt) | UC-08 | Bắt buộc | ⬜ (job) |
| FR-26 | Hoàn tiền chỉ hợp lệ khi tiền còn trong escrow (đơn `PAID..DISPUTED`); sau release hệ thống phải từ chối hoàn tiền tự động | UC-08 | Bắt buộc | ✅ (service + test) |
| FR-27 | Hệ thống phải đảm bảo tiền release/refund của một đơn không vượt quá số tiền đã nạp vào escrow của chính đơn đó | UC-08 | Bắt buộc | ✅ (test "escrow isolation") |

## 8.7. Nhóm 6 - Ví và banking

| ID | Yêu cầu chức năng | Use case | Độ ưu tiên | Trạng thái |
| -- | ----------------- | -------- | ---------- | ---------- |
| FR-28 | Mỗi user có đúng một ví VND, được tạo tự động khi đăng ký; không có API nào tạo/sửa số dư trực tiếp | UC-05 | Bắt buộc | ✅ |
| FR-29 | Nạp tiền chỉ được cộng sau khi PSP xác nhận qua webhook đã verify chữ ký; số tiền lấy từ payload PSP, không từ client | UC-05 | Bắt buộc | 🟨 (`confirmDeposit` ✅ + test; webhook ⬜) |
| FR-30 | Webhook retry (tuần tự hoặc đồng thời) chỉ cộng tiền đúng một lần | UC-05 | Bắt buộc | ✅ (test replay ×3 + race ×3) |
| FR-31 | Mọi giao dịch tiền phải là transfer cân bằng (tổng leg = 0) và bất biến sau khi ghi | UC-05, UC-08 | Bắt buộc | ✅ (DB trigger + test) |
| FR-32 | Số dư và sổ giao dịch trả cho client phải lấy từ ledger projection; sổ hiển thị `balanceAfter` từng dòng, phân trang cursor | UC-09 | Bắt buộc | ✅ (service) |
| FR-33 | Hệ thống phải phát hiện drift giữa số dư cache và ledger; drift khác 0 phải cảnh báo (không tự sửa) | UC-09 | Bắt buộc | 🟨 (`findBalanceDrift` ✅; job alert ⬜) |

## 8.8. Nhóm 7 - Rút tiền

| ID | Yêu cầu chức năng | Use case | Độ ưu tiên | Trạng thái |
| -- | ----------------- | -------- | ---------- | ---------- |
| FR-34 | Người dùng phải quản lý được tài khoản nhận tiền (PayoutMethod) với số tài khoản che một phần khi hiển thị | UC-10 | Bắt buộc | ⬜ |
| FR-35 | Người dùng tạo được lệnh rút (`REQUESTED`) với `Idempotency-Key`; không cho rút quá số dư khả dụng tại thời điểm duyệt | UC-10 | Bắt buộc | 🟨 (debit ✅ + test; endpoint ⬜) |
| FR-36 | Staff duyệt lệnh rút ⇒ tiền bị trừ khỏi ví ngay và giữ ở `WITHDRAWAL_CLEARING` (chống rút trùng trong lúc chờ ngân hàng) | UC-10 | Bắt buộc | ✅ (service) |
| FR-37 | Ngân hàng chuyển thành công ⇒ `SETTLED` (clearing → gateway); thất bại ⇒ transfer đảo hoàn tiền về ví, trạng thái `FAILED` | UC-10 | Bắt buộc | ✅ (service) |
| FR-38 | Mọi hành động duyệt/settle/fail phải do STAFF/ADMIN thực hiện và ghi audit kèm người thực hiện + lý do | UC-10 | Bắt buộc | 🟨 (reason/actor trong service ✅; audit ⬜) |

## 8.9. Nhóm 8 - Tranh chấp, vận hành và tuân thủ

| ID | Yêu cầu chức năng | Use case | Độ ưu tiên | Trạng thái |
| -- | ----------------- | -------- | ---------- | ---------- |
| FR-39 | Buyer phải mở được tranh chấp cho đơn chưa release; đơn chuyển `DISPUTED` và có audit | UC-08 | Nên làm | ⬜ |
| FR-40 | Staff xử lý tranh chấp: hoàn tiền (còn escrow) hoặc giải phóng cho seller, bắt buộc lý do | UC-08 | Bắt buộc | 🟨 (refund/release ✅; workflow ⬜) |
| FR-41 | Điều chỉnh sổ ngoại lệ (ADJUSTMENT) chỉ ADMIN được tạo, bắt buộc lý do, luôn có transfer đảo hoặc transfer mới có audit - không sửa dòng cũ | UC-08 | Bắt buộc | 🟨 (reverse() ✅; quyền admin ⬜) |
| FR-42 | Mọi thay đổi trạng thái nghiệp vụ phải sinh bản ghi AuditLog trong cùng transaction | UC-06, UC-08, UC-10 | Bắt buộc | ⬜ (bảng ✅, aspect ⬜) |
| FR-43 | Job đối soát định kỳ phải đọc `WalletReconciliation`/`LedgerIntegrity` và cảnh báo khi drift ≠ 0 | Tất cả | Bắt buộc | ⬜ |
| FR-44 | Hệ thống phải không lưu dữ liệu nhạy cảm dư thừa: số tài khoản đầy đủ không xuất hiện trong log/response; payload PSP không log toàn bộ | Tất cả | Bắt buộc | 🟨 (che số tài khoản ✅ trong model; quy tắc log ⬜) |
| FR-45 | Hệ thống phải hỗ trợ xuất báo cáo doanh thu/hoa hồng theo kỳ phục vụ kê khai thuế sàn TMĐT | UC-10 | Nên làm | ⬜ |

## 8.10. Ma trận truy vết

| Objective | Use case | Functional requirements |
| --------- | -------- | ----------------------- |
| Objective 1 | UC-02, UC-03 | FR-05 đến FR-15 |
| Objective 2 | UC-04, UC-06, UC-07, UC-08 | FR-16 đến FR-27, FR-39 đến FR-40 |
| Objective 3 | UC-05, UC-08, UC-09 | FR-28 đến FR-33, FR-41 |
| Objective 4 | UC-10 | FR-34 đến FR-38, FR-42 đến FR-45 |

## 8.11. Tóm tắt theo nhóm

| Nhóm | FR | Thành phần phụ trách | Ghi chú kiểm thử |
| ---- | -- | -------------------- | ---------------- |
| Danh tính & truy cập | FR-01..04 | Supabase Auth, NestJS guard | Test guard, role, tài khoản bị khóa |
| Catalog | FR-05..09 | Module catalog, Storage | Test lọc/phân trang, flash sale không oversell |
| Đơn B2C | FR-10..15 | Module order + banking | Test giữ chỗ, hết hạn, thanh toán, hủy |
| Listing & duyệt | FR-16..22 | Module listing + staff | Test workflow duyệt, audit, gửi lại |
| Escrow C2C | FR-23..27 | Banking (đã test) + listing/order | Đã có 5 nhóm test nền; còn test end-to-end qua API |
| Ví & banking | FR-28..33 | Banking (đã test) | Đã test: replay, concurrency, drift |
| Rút tiền | FR-34..38 | Banking (đã test) + staff UI | Đã test approve/settle/fail; còn audit và API |
| Tranh chấp & vận hành | FR-39..45 | Staff, audit, jobs | Test audit bất biến, job đối soát |

