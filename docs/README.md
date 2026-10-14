# Tài liệu dự án TNC Web Platform

> ⚠️ **2026-10-14 — đổi mô hình bán hàng:** showroom không xử lý thanh toán; nút mua deep-link sang gian hàng Shopee; backend tập trung **đồng bộ dữ liệu mặt hàng với Shopee**. Đặc tả: [backend/SHOPEE_SHOWROOM_BACKEND.md](backend/SHOPEE_SHOWROOM_BACKEND.md).

Thanh Nhàn Cosmetic: mô hình B2C (bán mỹ phẩm mới) kết hợp C2C (mỹ phẩm đã qua sử dụng), bán hàng qua **Shopee** (web là showroom), xây trên **Next.js + NestJS + Supabase**.

Cấu trúc thư mục theo chuẩn chung của các dự án (xem `docs_example/`):
đặc tả nhiều chương trong `Spectification/`, tài liệu kỹ thuật vận hành trong
`database/`, `api/`, `deployment/`, `frontend/`, và tài liệu sprint ở cấp `docs/`.

## Trạng thái hiện tại (2026-10-14)

| Khu vực | Trạng thái |
| ------- | ---------- |
| Banking core (ledger, escrow, hoa hồng, ví hệ thống) | ⏸️ Legacy mô hình cũ — ngừng phát triển, chờ gỡ |
| HTTP API `/api/v1` (`health`, `/health/db`, `/me`) | ✅ code + e2e + smoke test; `/wallet*`, `/orders/{id}/pay-wallet` thuộc mô hình cũ |
| **Shopee showroom backend** | ✅ S2 CSV + S3 catalog/curation API; 🟨 S4 Affiliate provider/scheduler đã code và test, chờ cấu hình credentials + reconciliation; S5 Open Platform cần Shopee duyệt (xem [đặc tả](backend/SHOPEE_SHOWROOM_BACKEND.md)) |
| Auth guard (Supabase JWT qua JWKS ES256/RS256 hoặc HS256), ProblemDetail RFC 7807, Idempotency-Key | ✅ |
| Frontend Next.js | 🟨 storefront công khai đã có trang chủ/catalog/PDP; admin curation, auth và các màn staff còn theo kế hoạch — xem [07](Spectification/TNCWebPlatform/07_Frontend.md) + [design brief](frontend/FRONTEND_DESIGN_BRIEF.md) |

## Mục lục

### Đặc tả dự án - `docs/Spectification/TNCWebPlatform/`

| # | Tài liệu | Nội dung |
| -- | -------- | -------- |
| 00 | [00_Introduction.md](Spectification/TNCWebPlatform/00_Introduction.md) | Thông tin tài liệu, thuật ngữ, cách sử dụng |
| 01 | [01_Background.md](Spectification/TNCWebPlatform/01_Background.md) | Bối cảnh kinh doanh, vấn đề, người dùng mục tiêu, phạm vi |
| 02 | [02_System_Architecture.md](Spectification/TNCWebPlatform/02_System_Architecture.md) | Kiến trúc tổng thể, phân chia trách nhiệm, luồng chính |
| 03 | [03_Objectives.md](Spectification/TNCWebPlatform/03_Objectives.md) | Mục tiêu SMART gắn với use case |
| 04 | [04_Infrastructure.md](Spectification/TNCWebPlatform/04_Infrastructure.md) | Hạ tầng: Supabase, Storage, Auth, môi trường, CI/CD |
| 05 | [05_Database.md](Spectification/TNCWebPlatform/05_Database.md) | Đặc tả cơ sở dữ liệu, bất biến tiền tệ |
| 06 | [06_Backend.md](Spectification/TNCWebPlatform/06_Backend.md) | Đặc tả backend NestJS: banking core, ledger, escrow |
| 07 | [07_Frontend.md](Spectification/TNCWebPlatform/07_Frontend.md) | Đặc tả frontend Next.js + shadcn/ui |
| 08 | [08_Functional_Requirement.md](Spectification/TNCWebPlatform/08_Functional_Requirement.md) | Yêu cầu chức năng (FR) |
| 09 | [09_NonFunctional_Requirement.md](Spectification/TNCWebPlatform/09_NonFunctional_Requirement.md) | Yêu cầu phi chức năng (NFR) |
| 10 | [10_Use_Cases.md](Spectification/TNCWebPlatform/10_Use_Cases.md) | Đặc tả use case chi tiết |
| 11 | [11_API_Specification.md](Spectification/TNCWebPlatform/11_API_Specification.md) | Đặc tả REST API `/api/v1` |
| 12 | [12_User_Manual.md](Spectification/TNCWebPlatform/12_User_Manual.md) | Hướng dẫn sử dụng theo vai trò |
| 13 | [13_Conclusion.md](Spectification/TNCWebPlatform/13_Conclusion.md) | Kết luận |
| 14 | [14_Appendix & Reference.md](Spectification/TNCWebPlatform/14_Appendix%20%26%20Reference.md) | Phụ lục, quyết định kỹ thuật, nguồn tham chiếu |

### Tài liệu kỹ thuật

| Tài liệu | Nội dung |
| -------- | -------- |
| [database/DATABASE.md](database/DATABASE.md) | Schema chi tiết, ERD, database guards, migration, vận hành |
| [api/API_TESTING.md](api/API_TESTING.md) | Kịch bản test endpoint bằng Postman/curl |
| [deployment/DEPLOYMENT.md](deployment/DEPLOYMENT.md) | Hướng dẫn deploy Supabase + NestJS + Vercel |
| [SPRINT_SETUP_AND_ENDPOINT_TESTING.md](SPRINT_SETUP_AND_ENDPOINT_TESTING.md) | Sprint HTTP đã hoàn thành: setup, kết quả test endpoint, bằng chứng |
| [backend/SHOPEE_SHOWROOM_BACKEND.md](backend/SHOPEE_SHOWROOM_BACKEND.md) | **Đặc tả backend mới**: showroom + đồng bộ Shopee, data model, API, lộ trình |
| [frontend/FRONTEND_DESIGN_BRIEF.md](frontend/FRONTEND_DESIGN_BRIEF.md) | Design brief frontend: ngôn ngữ thị giác, taste dial, badge tình trạng, PDP, prompt mẫu |

### Tài liệu nội bộ khác

| Tài liệu | Nội dung |
| -------- | -------- |
| [banking-design-review.md](banking-design-review.md) | Review thiết kế banking ngày 2026-10-14: phát hiện, bản vá, kết quả chạy test |

## Quy ước trạng thái

Mỗi hạng mục trong tài liệu được gắn nhãn trạng thái để phân biệt rõ cái gì
đang có trong repo và cái gì còn là thiết kế:

| Nhãn | Ý nghĩa |
| ---- | ------- |
| ✅ Đã có | Có trong repo và được kiểm chứng bằng test hoặc chạy thật |
| 🟨 Một phần | Đã có ở tầng service/logic, chưa có tầng HTTP/hạ tầng tương ứng |
| ⬜ Kế hoạch | Đặc tả thiết kế, chưa có code |

Cập nhật lần cuối: 2026-10-14.
