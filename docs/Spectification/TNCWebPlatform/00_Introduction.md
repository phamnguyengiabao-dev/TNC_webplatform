# 00. Giới thiệu

## 0.1. Thông tin tài liệu

| Mục | Giá trị |
| --- | ------- |
| Tên dự án | TNC Web Platform (Thanh Nhàn Cosmetic) |
| Loại tài liệu | Project Specification - bộ đặc tả dự án |
| Phiên bản | 0.1 (bản thảo đầu tiên) |
| Ngày cập nhật | 2026-10-14 |
| Trạng thái | Draft - cập nhật song song với tiến độ code |
| Ngôn ngữ | Tiếng Việt; thuật ngữ kỹ thuật, identifier, API contract giữ tiếng Anh |

## 0.2. Định vị sản phẩm

TNC Web Platform là nền tảng thương mại điện tử của thương hiệu mỹ phẩm
Thanh Nhàn Cosmetic, phục vụ đồng thời hai mô hình kinh doanh trên một hệ thống:

1. **B2C retail** - nền tảng bán mỹ phẩm mới, tồn kho theo lô, có danh mục sản
   phẩm và flash sale.
2. **C2C second-hand** - người dùng cá nhân đăng bán mỹ phẩm đã qua sử dụng
   (số lượng = 1, có tình trạng, % đã dùng, hạn dùng còn lại, ảnh chứng minh).
   Mọi tin đăng phải qua nhân viên duyệt trước khi hiển thị công khai.

Điểm khác biệt cốt lõi so với sàn thương mại điện tử thông thường: **hệ thống
ví nội bộ có escrow**. Tiền của người mua đi vào ví trung gian khi thanh toán và
chỉ được chuyển cho người bán khi đơn hoàn tất. Toàn bộ dòng tiền nằm trong
một sổ cái (ledger) bất biến, có thể đối soát.

Kiến trúc: **Next.js** (frontend) + **NestJS** (business logic, banking) +
**Supabase** (PostgreSQL, Storage/CDN, Auth). Xem
[02_System_Architecture.md](02_System_Architecture.md).

## 0.3. Lịch sử cập nhật

| Ngày | Phiên bản | Thay đổi |
| ---- | --------- | -------- |
| 2026-10-14 | 0.1 | Bản thảo đầu tiên: đặc tả đầy đủ 00-14; phản ánh hiện trạng repo (banking core + test đã xong) và phần còn là thiết kế |

## 0.4. Đối tượng sử dụng tài liệu

| Đối tượng | Nên đọc các chương |
| --------- | ------------------ |
| Chủ dự án / ban điều hành TNC | 01, 03, 08, 09, 13 |
| Product / BA | 01, 03, 08, 10, 12 |
| Backend engineer | 04, 05, 06, 08, 09, 11, `docs/database/`, `docs/api/` |
| Frontend engineer | 02, 04, 07, 11, 12 |
| DevOps / vận hành | 04, `docs/deployment/`, `docs/database/` |
| Kiểm thử (QA) | 08, 09, 10, 11, `docs/api/` |

## 0.5. Thuật ngữ, tiêu chuẩn và nguyên tắc áp dụng

| Thuật ngữ | Giải thích |
| --------- | ---------- |
| B2C | Business to Consumer - nền tảng bán hàng mới cho khách lẻ |
| C2C | Consumer to Consumer - người dùng bán cho người dùng |
| Listing | Tin đăng bán mỹ phẩm second-hand của người dùng |
| Escrow | Ví trung gian giữ tiền người mua cho đến khi đơn hoàn tất |
| Ledger | Sổ cái tài chính bất biến; mọi giao dịch là một transfer gồm các leg có dấu, tổng bằng 0 |
| PSP | Payment Service Provider - cổng thanh toán (PayOS, VietQR, Stripe...) |
| RLS | Row Level Security của PostgreSQL/Supabase |
| JWT | JSON Web Token do Supabase Auth phát hành sau khi đăng nhập |
| Idempotency-Key | Header chống xử lý trùng cho các endpoint tạo giao dịch |
| ProblemDetail | Định dạng lỗi RFC 7807 trả về từ mọi API lỗi |
| Đồng | Đơn vị tiền tệ VND; hệ thống chỉ hỗ trợ VND, không có phần lẻ |

Nguyên tắc kỹ thuật áp dụng xuyên suốt tài liệu:

1. **Tiền không bao giờ là `number` trong JS** - dùng `Prisma.Decimal`,
   `NUMERIC(18,2)`, JSON trả về dạng chuỗi.
2. **Số dư ví là dữ liệu dẫn xuất** - nguồn sự thật là `LedgerEntry`; bất biến
   này được database bảo vệ bằng trigger.
3. **Frontend không bao giờ được ghi tiền trực tiếp vào database** - mọi thao
   tác tiền đi qua NestJS; RLS mặc định đóng với các bảng tài chính.
4. **Mọi endpoint tạo giao dịch phải idempotent** - chống double-click và
   webhook retry.

## 0.6. Cách sử dụng tài liệu này

- Đọc theo thứ tự 00 → 13 ở lần đầu; về sau dùng từng chương như tài liệu tham
  chiếu.
- Cột **Trạng thái** trong các bảng yêu cầu/endpoint dùng quy ước tại
  [README.md](../../README.md): ✅ Đã có - 🟨 Một phần - ⬜ Kế hoạch.
- Các con số nghiệp vụ chưa được chủ dự án chốt (hoa hồng, thời gian giữ chỗ,
  thời gian auto-release) được đánh dấu rõ là *mặc định tạm* trong chương 03,
  06 và phụ lục.

## 0.7. Cấu trúc tài liệu

```text
docs/
  README.md                                  # mục lục
  Spectification/TNCWebPlatform/             # bộ đặc tả 00-14 (tài liệu này)
  database/DATABASE.md                       # hướng dẫn database chi tiết
  api/API_TESTING.md                         # kịch bản test endpoint
  deployment/DEPLOYMENT.md                   # hướng dẫn deploy
  SPRINT_SETUP_AND_ENDPOINT_TESTING.md       # setup sprint
  banking-design-review.md                   # review thiết kế banking (nội bộ)
```

## 0.8. Phạm vi cập nhật đặc tả

Bản 0.1 mô tả **toàn bộ thiết kế mục tiêu** (B2C, C2C, ví, escrow, vận hành)
đồng thời ghi rõ hiện trạng triển khai. Tại thời điểm viết:

- ✅ Đã có: schema database + database guards, hạ tầng ledger/banking service,
  bộ test tự động (17 unit + 34 e2e, chạy thật trên PostgreSQL).
- 🟨 Một phần: tầng banking đã đủ dùng ở mức service, chưa có HTTP layer.
- ⬜ Kế hoạch: HTTP API, auth guard, webhook, job định kỳ, catalog/listings/đơn
  hàng, toàn bộ frontend, deploy production.

