# Frontend Design Brief - TNC Web Platform

Tài liệu này chốt **ngôn ngữ thị giác** và **thông số "taste dial"** cho
frontend (Next.js), để sprint frontend bắt đầu với một hướng nhất quán thay vì
mỗi trang một kiểu. Nguồn: định hướng của chủ dự án (2026-10-14) + các ràng
buộc kỹ thuật đã có ở backend (xem [07_Frontend.md](../Spectification/TNCWebPlatform/07_Frontend.md)
và [11_API_Specification.md](../Spectification/TNCWebPlatform/11_API_Specification.md)).

> **Revision 2026-10-14**: mô hình mua hàng chuyển sang Shopee (deep-link); không còn checkout/ví nội bộ — xem [backend/SHOPEE_SHOWROOM_BACKEND.md](../backend/SHOPEE_SHOWROOM_BACKEND.md).

Phạm vi áp dụng: **toàn bộ storefront** (B2C mới + C2C đã qua sử dụng) và PDP.
Khu vực staff (`/duyet`, `/van-hanh`) dùng cùng token nhưng ưu tiên mật độ
thông tin hơn - xem ngoại lệ ở mục 5.

## 1. Định vị thị giác

TNC là **showroom mỹ phẩm cao cấp** bán hai dòng hàng cùng lúc: hàng mới (B2C)
và hàng đã qua sử dụng đã kiểm định (C2C). Giao diện phải khiến khách tin rằng
đồ second-hand ở đây được tuyển chọn và vệ sinh - không phải một chợ trời.

| Thuộc tính | Lựa chọn |
| ---------- | -------- |
| Tinh thần | Editorial, sạch, nhiều khoảng thở (whitespace) |
| Màu nền | Soft cream / warm beige (nền ấm, không trắng tinh) |
| Màu chữ | Deep charcoal `#1A1A1A`; phụ cấp dùng xám ấm, không dùng xám lạnh |
| Heading | Serif cao cấp (ví dụ Playfair Display) |
| Body / UI | Sans-serif sạch (ví dụ Inter/Geist) |
| Điểm nhấn | Rất tiết chế: 1 màu accent duy nhất cho CTA, không gradient |
| Viền/khối | Đường mảnh, viền nhẹ, đổ bóng gần như bằng 0 |

Được phép (và nên) phá cách ở **banner bộ sưu tập / hero**. Không được phá
cách ở **form nghiệp vụ admin, bảng vận hành** - các màn này giữ grid chuẩn, dễ
quét, không hiệu ứng lạ. Checkout/ví không thuộc scope - Shopee xử lý thanh toán.

## 2. Thông số "taste dial" cho AI agent

Khi giao việc cho AI agent (Cursor/v0/Claude Code/Codex), luôn truyền kèm khối
này để tránh sinh ra giao diện "AI-slop" mặc định:

```yaml
VISUAL_DENSITY: low        # 2-3 sản phẩm/hàng ở desktop; chừa nhiều khoảng trống
MOTION_INTENSITY: medium   # spring physics (framer-motion); không dùng linear easing
DESIGN_VARIANCE: medium-high  # hero/banner phá cách; màn vận hành giữ layout chuẩn
```

Hệ quả cụ thể:

- **Low density**: lưới sản phẩm tối đa 3 cột desktop / 2 cột tablet; mỗi card
  đủ lớn để nhìn rõ ảnh thật của sản phẩm second-hand.
- **Medium motion**: chuyển tab collection, mở gallery, drawer chọn màu son dùng
  `framer-motion` với spring; tôn trọng `prefers-reduced-motion`.
- **Medium-high variance**: tiêu đề collection có thể lệch trục/biên tập; PDP và
  màn vận hành theo lưới rõ ràng.

## 3. Hai dòng hàng, hai "thế giới" - nhưng một sản phẩm duy nhất

Không trộn lẫn hàng mới và hàng cũ theo cách gây nhầm lẫn. Hai dòng được tách
bằng **collection tab** (chuyển mượt, có thể dùng slider/tabs) thay vì checkbox
xám xịt ở sidebar:

| Collection | Cảm giác thiết kế | Ẩn dụ |
| ---------- | ---------------- | ----- |
| **Pristine Retail** | Sáng, sạch, quầy mall cao cấp | "quầy counter tại trung tâm thương mại" |
| **Curated Pre-loved** | Ấm, trầm hơn, như tủ đồ vintage | "wardrobe vintage được tuyển chọn" |

Trạng thái sản phẩm second-hand hiển thị bằng **typographic badge** thanh lịch
(không phải banner đỏ/vàng chói), ví dụ:

- `[New In Box]` - còn nguyên seal
- `[95% Left · Box Damaged]` - còn 95%, hộp móp
- `[Swatched Once]` - đã quẹt thử một lần

Quy ước với backend: badge lấy từ dữ liệu listing (tình trạng + % còn lại), UI
chỉ format lại chữ; các nhãn hiển thị là **copy tiếng Việt** theo bảng dịch của
frontend, không hard-code trong component dùng chung.

### Remaining volume

Mỗi card second-hand có **micro progress bar** thể hiện mức còn lại (ví dụ 90%),
dùng component `progress` của shadcn với chiều cao mảnh (~4px), màu accent trung
tính. Mục đích: quét nhanh bằng mắt, không cần mở PDP.

## 4. Product Detail Page (PDP)

Đây là nơi quyết định niềm tin - khách phải "soi" được món đồ đã qua sử dụng:

1. **Gallery ảnh thật (4:5 hoặc 1:1)**: carousel mượt (framer-motion/FLIP khi
   đổi ảnh), hỗ trợ zoom (click-to-zoom hoặc pinch) để nhìn rõ:
   - mức dung tích/khối lượng còn lại (vạch chia trên chai/hộp),
   - batch code + hạn sử dụng in trên bao bì,
   - tình trạng seal/nắp/vòi.
2. **Quality Assurance section** (trust building), trình bày dạng editorial list
   có icon, không phải bảng dashboard:
   - tình trạng vệ sinh / UV sterilization (khi áp dụng),
   - nguồn gốc sản phẩm (hoá đơn, kênh mua),
   - cam kết chính hãng (hoàn tiền theo chính sách Shopee).
3. **Khối mua qua Shopee**: CTA "Mua trên Shopee" mở tab mới (deep-link tới listing); nêu rõ
   giao dịch được Shopee bảo vệ: thanh toán, vận chuyển, hoàn tiền.

## 5. Anti-slop rules (bắt buộc)

1. Không dùng "dashboard box" chung chung (bo góc 12px + đổ bóng mờ + icon
   outline xếp lưới) cho storefront.
2. Không dùng gradient tím/xanh kiểu SaaS mặc định.
3. Không lạm dụng emoji trong UI sản phẩm (chỉ dùng trong thông báo vận hành nhỏ).
4. Không dùng nhiều hơn 1 màu accent; CTA chỉ nổi bật bằng tương phản chữ nền.
5. Motion phải có physics (spring), không dùng `ease-in-out` mặc định dài dòng.
6. Mọi màn hình API phải có đủ 3 trạng thái: loading (skeleton), empty (minh
   hoạ + CTA), error (thông điệp dịch từ `code` + nút thử lại).
7. Khu vực staff được phép dày đặc hơn (bảng, checklist) nhưng cùng token màu
   và font; không biến storefront thành dashboard.

## 6. Ràng buộc kỹ thuật đi kèm

- **Stack**: Next.js (App Router, TypeScript) + Tailwind CSS + shadcn/ui +
  framer-motion; TanStack Query cho data fetching; `@supabase/ssr` cho session.
- **Giá**: hiển thị từ **chuỗi** backend trả về (giá sync từ Shopee), format
  `Intl.NumberFormat('vi-VN')`; không `parseFloat` để tính toán. Luôn kèm ghi
  chú "giá tham khảo — giao dịch theo giá trên Shopee".
- **Không có checkout nội bộ**: frontend không thu tiền; nút mua deep-link sang
  Shopee. POST admin (import/sync) vẫn dùng `Idempotency-Key` để chống double-submit.
- **Lỗi**: body `application/problem+json` với `code` ổn định - frontend dùng
  bảng dịch `code` → thông điệp + hành động (ví dụ `PRODUCT_UNLISTED` → hiển thị
  trạng thái "tạm ngừng bán").
- **Ảnh**: ảnh sản phẩm mirror từ Shopee về Supabase Storage khi sync;
  `next/image` trỏ Supabase Storage CDN; PDP ưu tiên ảnh gốc chất lượng cao cho vùng zoom.

## 7. Prompt mẫu dán trực tiếp vào AI agent

Dùng nguyên khối dưới đây (đã gồm cả TNC context) khi nhờ agent dựng màn hình:

```markdown
Act as a Senior Frontend Developer and UI/UX Designer. Build a premium
E-commerce Showroom for a cosmetics brand selling both retail (new) and
second-hand/pre-loved luxury makeup and skincare products.

Apply a hybrid standard combining "UI/UX Pro Max" principles (for e-commerce
trust and conversion) and "Taste Skill" (for high-end, minimalist aesthetics).

Project context:
- Stack: Next.js (App Router, TypeScript), Tailwind CSS, shadcn/ui,
  framer-motion, TanStack Query.
- Backend API: NestJS at /api/v1 (RFC 7807 problem+json errors with stable
  `code`); prices are API strings (VND, synced from Shopee); no on-site checkout - buy CTA deep-links to Shopee.
- Two collections in one showroom: Pristine Retail (new) and Curated Pre-loved
  (verified second-hand), switchable via smooth tabs - never checkbox clutter.

Design Guidelines:
1. Theme & Vibe: Editorial, clean, and aesthetic. Use soft cream, warm beige,
   and deep charcoal text (#1A1A1A). Prioritize generous whitespace
   (minimalist approach).
2. Product Cards: Clearly distinguish between "Brand New" and "Pre-loved" items
   using elegant typographic badges rather than unsightly banners. For
   second-hand items, display a micro-progress bar indicating "Remaining
   Volume" (e.g., 90% left).
3. Product Filter: Implement smooth transition animations when switching
   between retail and second-hand collections.
4. Anti-Slop: No generic dashboard boxes, no harsh purple/blue gradients. Use
   sleek lines, subtle borders, and premium font pairings (e.g., a
   sophisticated Serif for headings like Playfair Display, and a clean
   Sans-serif for UI elements).
5. Technology Stack: React/Next.js, Tailwind CSS, Framer Motion (for smooth
   spring physics).

Taste dials: VISUAL_DENSITY=low (2-3 large products per row),
MOTION_INTENSITY=medium (spring physics, respect prefers-reduced-motion),
DESIGN_VARIANCE=medium-high (unconventional collection banners, standard grid
on admin/ops screens).
```

## 8. Tài liệu liên quan

- [07_Frontend.md](../Spectification/TNCWebPlatform/07_Frontend.md) - stack, route map, screen specs
- [11_API_Specification.md](../Spectification/TNCWebPlatform/11_API_Specification.md) - hợp đồng API và error catalog
- [SPRINT_SETUP_AND_ENDPOINT_TESTING.md](../SPRINT_SETUP_AND_ENDPOINT_TESTING.md) - mục 8: sprint frontend nằm trong S5
