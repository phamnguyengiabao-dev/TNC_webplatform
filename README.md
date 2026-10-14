# TNC Web Platform

Showroom mỹ phẩm Thanh Nhàn Cosmetic. Khách xem hàng mới và pre-loved trên
website; nút mua mở listing Shopee. Backend đồng bộ dữ liệu sản phẩm và phục vụ
catalog, không xử lý thanh toán.

## Công nghệ

- Backend: NestJS, TypeScript, Prisma, PostgreSQL/Supabase.
- Frontend: Next.js App Router, TypeScript, Tailwind CSS, Framer Motion.
- Shopee sync: Seller Center CSV; Affiliate Open API đang triển khai.

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
