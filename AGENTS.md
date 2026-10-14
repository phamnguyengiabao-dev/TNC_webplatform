# AGENTS.md — TNC Web Platform (Thanh Nhàn Cosmetic)

> Hướng dẫn bắt buộc cho mọi AI agent (Codex, Cursor, Claude Code, v0...) làm việc trong repo này.
> File này thắng thói quen chung/tutorial khi mâu thuẫn. Cập nhật: 2026-10-14.

## 0. Quy tắc chung (bắt buộc)

- Trả lời người dùng bằng **tiếng Việt**; giữ tiếng Anh cho code, identifier, API contract, log, commit message.
- Thay đổi chạm nhiều tầng (controller → service → DB/migration → frontend): nêu plan ngắn trước, implement, rồi verify bằng test.
- Diff tập trung theo task; không rename/refactor ngoài phạm vi. Không `git commit`/`git push`/tạo branch trừ khi được yêu cầu rõ.
- Không tuyên bố "đã chạy được" nếu chưa chạy test tương ứng; nếu không chạy được thì nói rõ lý do.
- Chi tiết nghiệp vụ chưa chốt → chọn default bảo thủ, nêu giả định trong summary.

## 1. Bối cảnh dự án & kiến trúc

TNC Web Platform là e-commerce "showroom mỹ phẩm" của Thanh Nhàn Cosmetic, chạy song song hai mô hình:

- **B2C retail**: mỹ phẩm mới, tồn kho theo lô, category, flash sale.
- **C2C pre-loved**: người dùng bán mỹ phẩm đã qua sử dụng (quantity = 1) kèm tình trạng (% còn lại, hạn dùng, ảnh bằng chứng); mọi listing phải qua **duyệt của staff** mới hiển thị.
- **Showroom bán qua Shopee**: nút mua là deep-link sang listing Shopee; toàn bộ thanh toán, vận chuyển, hoàn tiền do Shopee xử lý. Trọng tâm backend là **đồng bộ dữ liệu mặt hàng với Shopee**.

| Tầng | Công nghệ |
| --- | --- |
| Backend | NestJS (TypeScript) + Prisma ORM |
| Infrastructure | Supabase: Postgres, Storage (CDN ảnh), Auth (JWT — HS256 + ES256/RS256 qua JWKS) |
| Frontend | Next.js (App Router, TypeScript) + Tailwind CSS + shadcn/ui + framer-motion + TanStack Query + `@supabase/ssr` |
| Tích hợp Shopee | Sync engine đa provider: CSV (Seller Center) / Affiliate Open API / Open Platform v2 |
| Testing backend | Jest unit + Jest e2e (supertest, PostgreSQL thật dựng tự động) |

### Ranh giới trách nhiệm (bất biến)

- **Supabase = infrastructure + flat data.** NestJS = showroom core: catalog, curation, đồng bộ dữ liệu Shopee.
- **Shopee = nguồn sự thật cho thương mại** (giá, tồn kho, đơn, thanh toán, vận chuyển). Showroom không xử lý tiền — nút mua là deep-link sang listing Shopee.
- Banking/wallet/escrow/payment webhook thuộc mô hình cũ, **không phát triển thêm** — kế hoạch gỡ ở `docs/backend/SHOPEE_SHOWROOM_BACKEND.md`.

### Hợp đồng dữ liệu (contracts — không phá vỡ)

- **Giá**: giá sync từ Shopee — Decimal trong DB, trả **string** qua API; frontend format `Intl.NumberFormat('vi-VN')`, không `parseFloat` để tính toán; luôn kèm ghi chú "giá tham khảo — giao dịch theo giá trên Shopee".
- **Đồng bộ Shopee**: `(shop_id, item_id)` là khoá map; mọi lần sync phải log (`sync_runs`); không xoá cứng khi item biến mất — ẩn + báo admin.
- **Lỗi**: `application/problem+json` (RFC 7807) kèm `code` ổn định; frontend map `code` → thông điệp + hành động; backend không lộ chi tiết nội bộ (id kỹ thuật, payload Prisma, stack trace) ra response.
- **Auth**: guard mặc định **default-deny** (`@Public()` mới mở); role/`isBlocked` đọc từ DB mỗi request.
- Base path API: `/api/v1`.

## 2. Nguyên tắc frontend đã chốt

Chi tiết đầy đủ: `docs/frontend/FRONTEND_DESIGN_BRIEF.md` — **bắt buộc đọc trước khi viết UI**. Tóm tắt bất biến:

### 2.1 Ngôn ngữ thị giác

- Editorial, sạch, nhiều khoảng thở; nền soft cream / warm beige; chữ deep charcoal `#1A1A1A`; phụ cấp xám ấm (không xám lạnh).
- Heading serif cao cấp (Playfair Display); body/UI sans sạch (Inter/Geist).
- Đúng **1 màu accent** cho CTA; không gradient; viền mảnh, đổ bóng gần như bằng 0.
- Được phá cách ở hero/banner collection; **form admin/staff và bảng vận hành giữ grid chuẩn** — không hiệu ứng lạ ở màn nghiệp vụ.

### 2.2 Taste dials (kèm trong mọi prompt UI)

```yaml
VISUAL_DENSITY: low          # 2-3 sản phẩm/hàng desktop, 2 cột tablet
MOTION_INTENSITY: medium     # spring physics (framer-motion), tôn trọng prefers-reduced-motion
DESIGN_VARIANCE: medium-high # banner/hero phá cách; màn vận hành giữ layout chuẩn
```

### 2.3 Hai dòng hàng, hai "thế giới" — một showroom

- Tách hàng mới và hàng cũ bằng **collection tab chuyển mượt** (slider/tabs) — không dùng checkbox sidebar xám xịt:
  - **Pristine Retail** — cảm giác quầy counter mall cao cấp.
  - **Curated Pre-loved** — cảm giác tủ đồ vintage tuyển chọn.
- Trạng thái second-hand hiển thị bằng **typographic badge** thanh lịch, ví dụ `[New In Box]`, `[95% Left · Box Damaged]`, `[Swatched Once]`; nhãn tiếng Việt lấy từ bảng dịch frontend, không hard-code trong shared component.
- Card second-hand có **micro progress bar** mức còn lại (~4px, màu accent trung tính) để quét nhanh bằng mắt.

### 2.4 PDP (Product Detail Page)

- Gallery ảnh thật tỉ lệ **4:5 hoặc 1:1**, carousel mượt + zoom sâu để "soi": mức dung tích còn lại, batch code + hạn sử dụng, tình trạng seal/nắp/vòi.
- **Quality Assurance section** dạng editorial list có icon (không phải bảng dashboard): vệ sinh/UV sterilization, nguồn gốc sản phẩm, cam kết chính hãng (hoàn tiền theo chính sách Shopee).
- CTA "Mua trên Shopee" mở tab mới (deep-link); nêu rõ giao dịch được Shopee bảo vệ (thanh toán, vận chuyển, hoàn tiền).

### 2.5 Anti-slop rules (bắt buộc)

1. Không "dashboard box" chung chung (bo góc 12px + shadow mờ + icon outline xếp lưới) cho storefront.
2. Không gradient tím/xanh kiểu SaaS mặc định.
3. Không lạm dụng emoji trong UI sản phẩm.
4. Không dùng quá 1 màu accent; CTA nổi bật bằng tương phản chữ/nền.
5. Motion phải có physics (spring), không `ease-in-out` mặc định.
6. Mọi màn gọi API đủ 3 trạng thái: loading (skeleton), empty (minh hoạ + CTA), error (thông điệp dịch từ `code` + nút thử lại).
7. Khu vực staff (`/duyet`, `/van-hanh`) được dày đặc hơn (bảng, checklist) nhưng cùng token màu/font; không biến storefront thành dashboard.

## 3. Skills — combo bắt buộc cho mọi task UI/UX

**Chốt:** mọi task thiết kế / dựng / sửa UI phải kết hợp **`ui-ux-pro-max` (UXUI Pro Max) + `design-taste-frontend` (Taste Skill v2)**. Hai skill bổ trợ nhau, không thay thế nhau.

### 3.1 Phân vai

| Skill | Vai trò | Dùng cho |
| --- | --- | --- |
| `ui-ux-pro-max` | Cấu trúc UX, accessibility (WCAG 2.2), touch target 44×44, forms, navigation, dữ liệu typography/color/icons, guidance theo stack (nextjs/shadcn/react) | Mọi quyết định cấu trúc, luồng, a11y; fix UI "thiếu chuyên nghiệp"; khu vực staff |
| `design-taste-frontend` (Taste Skill v2) | Art direction (deal direction từ 247 site thật), anti-slop house style, đo bằng browser thật (`inspect.mjs`), vòng look-and-fix trên screenshot | Landing/collection banner/PDP/trang public; khi trang "trông generic/AI-made"; cần premium/award-level |

Thứ tự chuẩn: **Brief → ui-ux-pro-max (structure + a11y + design system) → Taste Skill (art direction + anti-slop) → build → inspect/lint + screenshot → fix.** Prompt mẫu dán trực tiếp nằm ở mục 7 của `docs/frontend/FRONTEND_DESIGN_BRIEF.md`.

### 3.2 Ưu tiên khi xung đột

1. Accessibility/usability (ui-ux-pro-max) > thẩm mỹ — không hy sinh a11y vì đẹp.
2. Ràng buộc đã chốt của dự án (mục 2) > default của skill.
3. Taste Skill quyết định cách trình bày thẩm mỹ; ui-ux-pro-max quyết định cấu trúc/luồng/a11y.
4. Taste Skill "not for dashboards/app screens" → khu vực staff dùng ui-ux-pro-max + shadcn là đủ.

### 3.3 Lệnh chạy (Windows)

`ui-ux-pro-max` là skill global, dùng `python` (không phải `python3`):

```powershell
python "C:/Users/hoang/.agents/skills/ui-ux-pro-max/scripts/search.py" "cosmetics ecommerce showroom retail second hand" --design-system --variance 6 --motion 5 --density 2 -p "TNC Web Platform"
python "C:/Users/hoang/.agents/skills/ui-ux-pro-max/scripts/search.py" "<keyword>" --domain ux|style|typography|color|icons|gsap|chart
python "C:/Users/hoang/.agents/skills/ui-ux-pro-max/scripts/search.py" "<keyword>" --stack nextjs|react|shadcn|html-tailwind
```

Mapping taste dials sang tham số `search.py`: `VISUAL_DENSITY: low → --density 2`; `MOTION_INTENSITY: medium → --motion 5`; `DESIGN_VARIANCE: medium-high → --variance 6-7`.

Taste Skill là skill project-local, cần Node 22+ và Chrome/Edge/Chromium:

```powershell
node .agents/skills/design-taste-frontend/scripts/draw.mjs --sector <sector> --brief "<one line>" --sections <roles> --tone luxury --options 3
node .agents/skills/design-taste-frontend/scripts/draw.mjs ... --direction <id>      # chốt full direction sheet
node .agents/skills/design-taste-frontend/scripts/inspect.mjs <url-hoặc-file-html>   # đo house style bằng browser thật
node .agents/skills/design-taste-frontend/scripts/lint.mjs <nguồn>                   # quét banned patterns
```

- Xem `--list sectors` / `--list roles` trước khi draw; sector hợp với TNC: `physical-product` / `fashion` / `ecommerce`; tone gợi ý: `luxury` hoặc `editorial`.
- Brand đã cố định palette/type (mục 2) → truyền `--keep palette,type` để skill chỉ deal composition.

### 3.4 Skills hỗ trợ (project-local, dùng khi hợp cảnh)

- `imagegen-frontend-web` — sinh ảnh design reference từng section trước khi code.
- `image-to-code` — đã có ảnh thiết kế, implement khớp nhất có thể.
- `redesign-existing-projects` — nâng UI sẵn có lên chuẩn premium, không phá chức năng.
- `high-end-visual-design` — checklist font/spacing/shadow "trông đắt tiền".
- `minimalist-ui` — tham chiếu editorial/monochrome tối giản.
- `full-output-enforcement` — task cần output code đầy đủ, không truncate.
- **Không thuộc hướng đã chốt** (chỉ dùng khi được yêu cầu rõ): `industrial-brutalist-ui`, `gpt-taste`, `stitch-design-taste`, `brandkit`, `design-taste-frontend-v1`, `design-taste-frontend-v2-experimental`.

## 4. Lệnh build & test (backend)

| Lệnh | Ý nghĩa |
| --- | --- |
| `npm run typecheck` | TypeScript check (tsc --noEmit) |
| `npm run test:unit` | Jest unit (nhanh) |
| `npm run test:e2e` | Jest e2e — tự dựng PostgreSQL 18 local (port 55432) + `prisma migrate deploy` |
| `npm test` | unit + e2e |
| `npm run build` | build ra `dist/` |
| `npx prisma migrate deploy` | apply migrations vào DB |

Trước khi báo hoàn thành: `npm run typecheck` + test liên quan phải xanh.

## 5. Bản đồ tài liệu

| Tài liệu | Nội dung |
| --- | --- |
| `docs/README.md` | Mục lục + trạng thái tài liệu |
| `docs/frontend/FRONTEND_DESIGN_BRIEF.md` | Ngôn ngữ thị giác, taste dials, prompt mẫu — đọc trước khi làm UI |
| `docs/backend/SHOPEE_SHOWROOM_BACKEND.md` | **Đặc tả backend mới** (đọc trước khi làm backend): showroom + sync Shopee, data model, lộ trình |
| `docs/Spectification/TNCWebPlatform/` | Đặc tả 00–14 (kiến trúc, database, backend, frontend, API, use cases...) |
| `docs/api/API_TESTING.md` | Checklist test API thủ công |
| `docs/deployment/DEPLOYMENT.md` | Env vars, deploy |
| `docs/database/DATABASE.md` | Database |
| `docs/SPRINT_SETUP_AND_ENDPOINT_TESTING.md` | Sprint hiện tại + bằng chứng test |
| `docs/banking-design-review.md` | Review thiết kế banking |
| `CLAUDE.md` | Quy tắc chất lượng chi tiết (một số mục còn dấu vết Spring Boot cũ — bỏ qua phần lỗi thời) |
