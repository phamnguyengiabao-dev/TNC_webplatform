> ⚠️ **REVISION 2026-10-14 — mô hình bán hàng đã đổi sang Shopee.** Showroom không xử lý thanh toán; nút mua deep-link sang gian hàng Shopee; backend tập trung **đồng bộ dữ liệu mặt hàng với Shopee**. Các nội dung wallet/escrow/orders/payment trong tài liệu này thuộc mô hình cũ — thay thế bởi [SHOPEE_SHOWROOM_BACKEND.md](../../backend/SHOPEE_SHOWROOM_BACKEND.md).

# 01. Bối cảnh

## 1.1. Bối cảnh

### 1.1.1. Thực trạng

Thanh Nhàn Cosmetic (TNC) là thương hiệu mỹ phẩm đang bán hàng qua kênh trực
tiếp và mạng xã hội. Hai nhu cầu xuất hiện cùng lúc:

1. **Mở kênh bán hàng online chính thức (B2C)** cho mỹ phẩm mới: danh mục sản
   phẩm, tồn kho, khuyến mãi/flash sale, đặt hàng và thanh toán.
2. **Mở chợ đồ đã qua sử dụng (C2C)**: người dùng có mỹ phẩm dùng dở (son, kem,
   nước hoa...) muốn "pass" lại. Thị trường này sôi động trên các hội nhóm mạng
   xã hội nhưng giao dịch hoàn toàn dựa trên niềm tin.

Đặc thù second-hand mỹ phẩm: mỗi món chỉ có **số lượng = 1**, giá trị nhỏ,
nhưng rủi ro cao (hàng giả, hàng hết hạn, tình trạng không đúng mô tả). Người
mua phải trả tiền trước khi cầm hàng; người bán phải gửi hàng trước khi nhận
tiền.

### 1.1.2. Sản phẩm tương tự

| Nhóm | Ví dụ | Hạn chế với bài toán của TNC |
| ---- | ----- | ----------------------------- |
| Sàn TMĐT lớn | Shopee, Lazada, TikTok Shop | Quy trình niêm yết nặng, không có cơ chế kiểm duyệt chuyên biệt cho mỹ phẩm second-hand; dòng tiền do sàn giữ, TNC không kiểm soát |
| Hội nhóm mạng xã hội | Các group "pass đồ mỹ phẩm" | Không kiểm duyệt, không escrow, tranh chấp không có bên phân xử |
| Shop pass đồ tự phát | Instagram/Facebook shop nhỏ | Không có hệ thống ví/sổ cái, đối soát thủ công, không mở rộng được |

## 1.2. Vấn đề cần giải quyết

| # | Vấn đề | Hệ quả nếu không giải quyết |
| - | ------ | --------------------------- |
| P1 | Người mua C2C phải trả trước nhưng không có gì đảm bảo người bán gửi hàng | Mất niềm tin, không ai dám mua second-hand trên nền tảng |
| P2 | Người bán nhận tiền ngay khi người mua thanh toán | Gặp rủi ro ngược - người mua gian lận/hoàn tiền trái phép; đòi lại tiền là chuyện ngoài hệ thống |
| P3 | Không kiểm soát hàng second-hand (fake, hết hạn, sai mô tả) | Ảnh hưởng uy tín thương hiệu TNC khi đứng chung nền tảng |
| P4 | Dòng tiền không minh bạch, không đối soát được | Không biết lệch vì bug, vì hoa hồng, hay vì sửa tay; báo cáo tài chính không đáng tin |
| P5 | Rủi ro pháp lý khi giữ tiền khách (ví, escrow) | Cần thiết kế đúng ngay từ đầu, không thể chắp vá sau (xem 09, phụ lục) |

Lời giải cốt lõi của nền tảng:

- **Escrow nội bộ**: tiền người mua vào ví trung gian, người bán chỉ được trả
  khi đơn giao thành công; hoàn tiền trước lúc đó chỉ là một bút toán.
- **Duyệt tin đăng C2C bởi nhân viên** trước khi hiển thị công khai.
- **Sổ cái bất biến** làm nguồn sự thật cho mọi dòng tiền, có bất biến do
  database bảo vệ (tổng mọi transfer = 0).

## 1.3. Người dùng mục tiêu

### 1.3.1. User classes, characteristics và quyền truy cập

| Actor | Mô tả | Quyền chính |
| ----- | ----- | ----------- |
| Guest (khách) | Chưa đăng nhập | Xem catalog sản phẩm/tin đăng đã duyệt, tìm kiếm |
| Buyer (người mua) | Tài khoản đã đăng nhập | Mua B2C/C2C, nạp tiền, xem sổ ví, tạo yêu cầu rút, mở tranh chấp, đánh giá |
| Seller (người bán) | Buyer có đăng bán second-hand | Tạo/quản lý tin đăng, xem đơn bán, nhận tiền sau khi đơn hoàn tất |
| Staff (nhân viên) | Nhân viên TNC | Duyệt/từ chối tin đăng, duyệt/settle/fail lệnh rút, release/refund đơn, xử lý tranh chấp |
| Admin | Quản trị hệ thống | Toàn bộ quyền staff + quản lý danh mục, sản phẩm B2C, cấu hình hệ thống |
| System | Thành phần tự động | Scheduled job (release escrow, hết hạn giữ chỗ), webhook PSP, đối soát |

## 1.4. Mục đích sản phẩm

1. Bán mỹ phẩm mới (B2C) với quy trình đặt hàng - thanh toán - giao vận tiêu
   chuẩn, tồn kho theo lô.
2. Cho phép cộng đồng mua bán mỹ phẩm second-hand **an toàn hai chiều**: người
   mua được bảo vệ bởi escrow, người bán được bảo vệ khỏi hoàn tiền tùy tiện.
3. Vận hành dòng tiền minh bạch: ví nội bộ, hoa hồng nền tảng, lệnh rút kiểm
   soát bởi nhân viên, sổ cái đối soát tự động.
4. Tuân thủ các quy định hiện hành về trung gian thanh toán và thuế sàn TMĐT
   (xem 09_NonFunctional_Requirement).

## 1.5. Từ mục đích sản phẩm suy ra mục tiêu

| Mục đích | Mục tiêu SMART |
| -------- | -------------- |
| (1) Bán mỹ phẩm mới | Objective 1 - xem [03_Objectives.md](03_Objectives.md) |
| (2) C2C an toàn hai chiều | Objective 2 |
| (3) Dòng tiền minh bạch | Objective 3 |
| (4) Tuân thủ & vận hành | Objective 4 |

## 1.6. Phạm vi sản phẩm

### Trong phạm vi

- Catalog B2C (danh mục, sản phẩm, tồn kho, flash sale) và C2C (tin đăng đã
  duyệt).
- Ví nội bộ VND: nạp tiền qua PSP, thanh toán, sổ cái, escrow, hoa hồng.
- Lệnh rút tiền qua ngân hàng với quy trình duyệt của nhân viên.
- Duyệt tin đăng second-hand; tranh chấp và hoàn tiền.
- Audit trail cho mọi thay đổi trạng thái nghiệp vụ/tiền tệ.
- Web frontend (Next.js) cho buyer/seller; khu vực staff.

### Ngoài phạm vi (bản 0.1)

- Ứng dụng mobile native (chỉ web responsive).
- Đa tiền tệ (chỉ VND) và đa ngôn ngữ UI (chỉ tiếng Việt).
- Logistic tích hợp đối tác vận chuyển (ghi nhận trạng thái giao hàng thủ công).
- Live streaming bán hàng, chat realtime giữa người mua - người bán.
- Cổng thanh toán thẻ quốc tế (Stripe để mở, chỉ bật khi đủ điều kiện vận hành).
