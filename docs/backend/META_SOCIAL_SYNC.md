# Đồng bộ ảnh Facebook và Instagram

## Mục tiêu và ranh giới

Meta là nguồn bài đăng và ảnh. Dữ liệu được nhập vào `SocialMediaItem`, mặc định ở trạng thái `PENDING`; admin chọn từng ảnh trong bài đăng rồi công khai trước khi khách xem tại `/thu-vien-anh`. Ảnh không tự gắn hoặc thay ảnh sản phẩm, và Meta không thay thế Shopee làm nguồn giá/tồn kho.

## Kết nối Meta

- Facebook: Facebook Page do TNC quản lý, đọc các bài đăng đã xuất bản bằng Page access token và quyền `pages_read_engagement`; `pages_show_list` dùng để lấy danh sách Page/token trong bước kết nối.
- Instagram: tài khoản Professional (Business/Creator), liên kết với Facebook Page; đọc media qua Instagram Graph API với quyền `instagram_basic`.
- Cấu hình ở backend: `META_ACCESS_TOKEN`, `META_FACEBOOK_PAGE_ID`, `META_INSTAGRAM_ACCOUNT_ID`, `META_GRAPH_VERSION`.
- Dùng app Meta và token dài hạn phù hợp cho môi trường chạy thật. Quyền cần qua App Review khi dùng với tài khoản ngoài vai trò app; không commit token và không gửi token xuống browser.
- Bộ sync chỉ tải bài đăng và media gần nhất (tối đa 20 trang × 100 bài mỗi nguồn/lần). Dùng cursor của Graph API; không scrape web.

## API

| Method | Endpoint | Quyền | Mô tả |
| --- | --- | --- | --- |
| GET | `/api/v1/social-media` | Public | Danh sách ảnh trạng thái `PUBLIC` |
| GET | `/api/v1/admin/social-media?visibility=PENDING` | ADMIN | Danh sách ảnh để duyệt |
| POST | `/api/v1/admin/social-media/sync` | ADMIN + `Idempotency-Key` | Đồng bộ Facebook và/hoặc Instagram đã cấu hình |
| PATCH | `/api/v1/admin/social-media/{id}/visibility` | ADMIN | `PENDING`, `PUBLIC` hoặc `HIDDEN`; gửi `selectedMediaUrls` khi công khai |

Tất cả thao tác sync được ghi vào `SyncRun` với provider `META`; không xóa ảnh khi bài đăng biến mất khỏi feed. Role được đọc từ DB bởi guard hiện hữu mỗi request. `SocialMediaItem` bật RLS và từ chối quyền trực tiếp của Supabase `anon`/`authenticated`; truy cập qua Nest API.

## Giao diện

- Khách: `/thu-vien-anh`, chỉ hiển thị nội dung `PUBLIC`, có trạng thái rỗng/lỗi.
- Admin: `/admin/social-media`, đăng nhập Supabase Auth, API xác nhận role `ADMIN`, đồng bộ, lọc theo trạng thái, mở bài gốc, chọn từng ảnh trong carousel, rồi công khai hoặc ẩn.
- Hai tài khoản dev mẫu và cấu hình nằm trong README.

## Giới hạn hiện tại

Ảnh đang dùng URL CDN Meta trả về; hệ thống lưu URL và metadata, chưa mirror file vào Supabase Storage. URL ảnh có thể hết hạn theo chính sách CDN. Trước khi dùng làm kho ảnh lâu dài, cần cấu hình bucket private/public phù hợp và triển khai mirror ảnh cùng quy trình dọn dữ liệu theo chính sách lưu trữ Meta.

## Cài đặt

1. Điền Meta IDs/token và `META_GRAPH_VERSION` trong backend `.env`.
2. Điền Supabase public URL/anon key vào `frontend/.env.local`.
3. Chạy `npm run db:deploy` tại repo root.
4. Khởi động API và frontend. Đăng nhập bằng user có role `ADMIN` tại `/admin/social-media`.
