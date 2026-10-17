# TNC Web Platform

Showroom mỹ phẩm Thanh Nhàn Cosmetic. Khách xem hàng mới và pre-loved trên
website; nút mua mở listing Shopee. Backend đồng bộ dữ liệu sản phẩm và phục vụ
catalog, không xử lý thanh toán.

## Công nghệ

- Backend: NestJS, TypeScript, Prisma, PostgreSQL/Supabase.
- Frontend: Next.js App Router, TypeScript, Tailwind CSS, Framer Motion.
- Đồng bộ dữ liệu: Shopee (CSV/Affiliate) và thư viện ảnh Meta (Facebook Page + Instagram Professional).

## Bắt đầu

Yêu cầu Node.js 22 trở lên. Cấu hình `.env` từ `.env.example` cho backend và
`frontend/.env.local` từ `frontend/.env.example` cho storefront.

```powershell
npm ci
npm run typecheck
npm test
npm run build

cd frontend
npm ci
npm run typecheck
npm run dev
```

Backend API chạy dưới `/api/v1` trên cổng `3001`; storefront dev server dùng cổng `3000`.

## Tài liệu

- [Trạng thái và mục lục tài liệu](docs/README.md)
- [Đặc tả showroom và Shopee sync](docs/backend/SHOPEE_SHOWROOM_BACKEND.md)
- [Frontend design brief](docs/frontend/FRONTEND_DESIGN_BRIEF.md)
- [Cấu hình triển khai](docs/deployment/DEPLOYMENT.md)

Không commit `.env`, `frontend/.env.local` hoặc credentials Shopee/Supabase.

## Đồng bộ ảnh Facebook và Instagram

Luồng khách xem ảnh đã chọn tại `/thu-vien-anh`. Admin đăng nhập ở `/admin/social-media`, đồng bộ bài đăng, chọn từng ảnh trong bài đăng/carousel, rồi công khai hoặc ẩn ảnh. Mỗi bài đăng Meta mới được nhập ở trạng thái chờ duyệt; ảnh này không tự gắn vào sản phẩm Shopee.

Backend cần `META_ACCESS_TOKEN`, `META_FACEBOOK_PAGE_ID` và/hoặc `META_INSTAGRAM_ACCOUNT_ID` trong `.env`. Dùng Page access token có `pages_read_engagement`; Instagram phải là tài khoản Professional được liên kết với Page và app phải có quyền `instagram_basic`. Token chỉ nằm ở backend, không đặt trong frontend. Chạy migration bằng `npm run db:deploy`.

Frontend cần `NEXT_PUBLIC_SUPABASE_URL` và `NEXT_PUBLIC_SUPABASE_ANON_KEY` trong `frontend/.env.local`. Meta credentials và quyền App Review phụ thuộc cấu hình của tài khoản Meta; xem [hướng dẫn sync social](docs/backend/META_SOCIAL_SYNC.md).

### Hai danh tính thử nghiệm

Tạo hai người dùng trong Supabase Auth của project dev (email xác minh tắt hoặc xác minh email trước khi đăng nhập), sau đó gán role trong `public."UserProfile"`:

| Vai trò | Email thử nghiệm | Luồng kiểm tra |
| --- | --- | --- |
| USER | `user.test@tnc.local` | Mở `/thu-vien-anh`; ảnh đang chờ/ẩn không được trả về. |
| ADMIN | `admin.test@tnc.local` | Đăng nhập tại `/admin/social-media`; chạy sync, công khai và ẩn ảnh. |

Đặt mật khẩu riêng trong Supabase Auth khi tạo hai tài khoản; không ghi mật khẩu hoặc access token vào README. Gán quyền admin sau khi tạo user:

```sql
UPDATE public."UserProfile" SET role = 'ADMIN' WHERE email = 'admin.test@tnc.local';
UPDATE public."UserProfile" SET role = 'USER' WHERE email = 'user.test@tnc.local';
```
