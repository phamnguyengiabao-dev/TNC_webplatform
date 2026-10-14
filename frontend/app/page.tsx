import Image from 'next/image';
import Link from 'next/link';

import { CollectionShowcase } from '@/components/home/collection-showcase';
import { StickyPhoto, type StagePhoto } from '@/components/home/sticky-photo';
import { ProductGrid } from '@/components/domain/product-grid';
import { Button } from '@/components/ui/button';
import { catalogApi } from '@/lib/api';
import type { CollectionView, ProductCardView } from '@/lib/types';

/**
 * Trang chủ theo direction "The split stage" (taste skill, 2026-10-14):
 * nửa màn hình là một tấm ảnh đứng yên, nửa còn lại là cột chữ chảy chậm.
 * Tấm ảnh là ảnh tư liệu của thế giới mỹ phẩm (bộ sưu tập mở), không phải ảnh
 * sản phẩm - nên nó chỉ được đứng ở vai trò không khí, và luôn được ghi nguồn.
 */

const PHOTOS: StagePhoto[] = [
  {
    src: '/assets/dressing-table-mirror.jpg',
    alt: 'Gương trang điểm khảm vàng có điêu khắc mặt người, hiện vật bảo tàng',
    caption: 'Ảnh tư liệu: gương trang điểm khảm vàng, Wikimedia Commons (CC0).',
  },
  {
    src: '/assets/perfume-bottles.jpg',
    alt: 'Những chai nước hoa thuỷ tinh vàng và xanh trên khay đá',
    caption: 'Ảnh tư liệu: chai nước hoa, Wikimedia Commons (CC BY-SA 3.0).',
  },
  {
    src: '/assets/makeup-table1886.jpg',
    alt: 'Bàn trang điểm gỗ có gương, ảnh in năm 1886',
    caption: 'Ảnh tư liệu: bàn trang điểm, 1886, Wikimedia Commons (public domain).',
  },
];

const INSPECTION_KINDS = [
  {
    kind: 'Trước khi lên kệ',
    items: [
      'Mức dung tích còn lại (%)',
      'Tình trạng seal, nắp, vòi',
      'Hạn dùng và batch code in trên bao bì',
      'Hoá đơn hoặc kênh mua ban đầu',
      'Vệ sinh và khử khuẩn UV-C',
      'Ảnh thật của chính món đó',
    ],
  },
  {
    kind: 'Trên trang sản phẩm',
    items: [
      'Mã sản phẩm trên gian hàng Shopee',
      'Thời điểm giá được đồng bộ',
      'Tồn kho thật của gian hàng',
      'Ghi chú kiểm định của staff',
      'Chính sách đổi trả của Shopee',
      'Giá tham khảo kèm nguồn đồng bộ',
    ],
  },
];

const FAQ = [
  {
    question: 'Mua ở đâu và trả tiền cho ai?',
    answer:
      'Bạn bấm "Mua trên Shopee" ở trang sản phẩm. Thanh toán, vận chuyển, bảo hành và hoàn tiền đều diễn ra trên gian hàng Shopee của TNC; showroom không thu tiền của bạn.',
  },
  {
    question: 'Vì sao giá ghi "tham khảo"?',
    answer:
      'Giá được đồng bộ từ gian hàng Shopee nên có thể lệch vài phút so với giá bạn thấy lúc đặt. Giá cuối cùng luôn là giá trên Shopee tại thời điểm bạn thanh toán.',
  },
  {
    question: 'Món pre-loved còn bao nhiêu phần trăm?',
    answer:
      'Mỗi món đều ghi rõ mức dung tích còn lại và tình trạng seal ngay trên card, kèm thanh dung tích để bạn quét bằng mắt. Trang chi tiết có ảnh zoom để soi vạch chia và batch code.',
  },
  {
    question: 'Hàng đã qua sử dụng thì đổi trả thế nào?',
    answer:
      'Áp dụng theo chính sách của Shopee cho đơn hàng đó. Vì tiền đi qua Shopee, bạn khiếu nại trực tiếp trên đơn và được Shopee xử lý.',
  },
  {
    question: 'Món đã bán thì sao?',
    answer:
      'Khi gian hàng ngừng bán một món, showroom tự động ẩn món đó khỏi danh sách. Nếu bạn vào bằng đường dẫn cũ, trang sẽ báo món đã tạm ngừng bán thay vì dẫn tới một liên kết chết.',
  },
];

export default async function HomePage() {
  const [collectionsResult, featured, newest] = await Promise.allSettled([
    catalogApi.collections(),
    catalogApi.products({ sort: 'featured', take: 3 }),
    catalogApi.products({ sort: 'newest', take: 3 }),
  ]);

  const collections: CollectionView[] =
    collectionsResult.status === 'fulfilled' ? collectionsResult.value.items : [];

  const shelf = dedupe([
    ...(featured.status === 'fulfilled' ? featured.value.items : []),
    ...(newest.status === 'fulfilled' ? newest.value.items : []),
  ]).slice(0, 6);

  return (
    <>
      <div className="px-3 pb-3">
        <div className="mx-auto grid max-w-[1600px] gap-3 lg:grid-cols-2">
          <div className="rounded-card bg-paper px-6 py-12 sm:px-12 lg:px-16 lg:py-20">
            <div className="mx-auto flex max-w-[46ch] flex-col gap-24">
              <header className="lg:pt-[18svh]">
                <h1 className="max-w-[13ch] font-display text-display text-accent">
                  Đồ cũ, chuẩn như hàng mới.
                </h1>
                <p className="mt-6 max-w-[40ch]">
                  Thanh Nhàn Cosmetic để bạn soi từng vạch dung tích, hạn dùng và tình trạng seal
                  trước khi mua. Còn thanh toán và vận chuyển, Shopee lo.
                </p>
                <div className="mt-8">
                  <Button asChild size="lg">
                    <Link href="/san-pham">Xem showroom</Link>
                  </Button>
                </div>
              </header>

              <section aria-label="Giới thiệu showroom" className="max-w-[34ch]">
                <p>
                  Showroom bày hai dòng hàng cùng lúc: mỹ phẩm mới nguyên seal và mỹ phẩm pre-loved
                  đã tuyển chọn.
                </p>
                <p className="mt-5 text-ink-soft">
                  Không món pre-loved nào lên kệ trước khi có người mở hộp, soi vạch dung tích, đọc
                  batch code và chụp lại ảnh thật của chính nó.
                </p>
                <p className="mt-5 text-ink-soft">
                  Mọi thứ bạn đọc ở đây, gồm giá, tồn kho và trạng thái bán, đều được đồng bộ từ
                  gian hàng Shopee. Gian hàng dừng bán thì showroom cũng dừng theo.
                </p>
                <p className="mt-5 text-ink-soft">
                  Bạn không phải tin lời giới thiệu:{' '}
                  <Link href="#kiem-dinh" className="link-underline">
                    xem chúng tôi kiểm những gì
                  </Link>
                  .
                </p>
              </section>

              {collections.length > 0 && <CollectionShowcase collections={collections} />}

              <section id="kiem-dinh" aria-labelledby="kiem-dinh-heading" className="scroll-mt-8">
                <h2 id="kiem-dinh-heading" className="font-display text-title">
                  Kiểm định từng món
                </h2>
                <div className="mt-8 grid grid-cols-1 gap-10 sm:grid-cols-2 sm:gap-8">
                  {INSPECTION_KINDS.map((group) => (
                    <div key={group.kind}>
                      <p className="text-ink-soft">{group.kind}</p>
                      <ul className="mt-4 space-y-3 text-body leading-snug">
                        {group.items.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </section>

              <section aria-labelledby="faq-heading">
                <h2 id="faq-heading" className="font-display text-title">
                  Hỏi trước khi mua
                </h2>
                <div className="mt-6">
                  {FAQ.map((entry) => (
                    <details key={entry.question} className="group py-4">
                      <summary className="flex cursor-pointer list-none items-center justify-between gap-6 text-lead">
                        {entry.question}
                        <span
                          aria-hidden
                          className="relative h-3 w-3 shrink-0 before:absolute before:left-0 before:top-1/2 before:h-0.5 before:w-3 before:bg-ink after:absolute after:left-1/2 after:top-0 after:h-3 after:w-0.5 after:bg-ink group-open:after:hidden"
                        />
                      </summary>
                      <p className="mt-3 max-w-[46ch] text-ink-soft">{entry.answer}</p>
                    </details>
                  ))}
                </div>
              </section>

              <section aria-label="Câu hỏi thêm" className="pt-4">
                <p className="text-note text-ink-soft">
                  Còn điều gì chưa rõ, bạn nhắn gian hàng trên Shopee, staff trả lời trực tiếp ở đó.
                </p>
              </section>
            </div>
          </div>

          <StickyPhoto photos={PHOTOS} />
        </div>
      </div>

      <section aria-labelledby="shelf-heading" className="shelf py-24">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <h2 id="shelf-heading" className="font-display text-title">
            Đang trên kệ
          </h2>
          <Link href="/san-pham" className="link-underline text-note">
            Xem toàn bộ showroom
          </Link>
        </div>

        <div className="mt-14">
          {shelf.length > 0 ? (
            <ProductGrid products={shelf} />
          ) : (
            <div className="rounded-card bg-field px-8 py-16">
              <p className="max-w-reading text-ink-soft">
                Staff đang đưa những món đầu tiên lên kệ. Bạn xem hai bộ sưu tập để biết showroom
                bày gì, hoặc quay lại sau ít phút.
              </p>
              <div className="mt-8 flex flex-wrap gap-4">
                {collections.map((entry) => (
                  <Button key={entry.slug} asChild variant="surface">
                    <Link href={`/san-pham?collection=${entry.slug}`}>{entry.title}</Link>
                  </Button>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>

      <section aria-label="Bắt đầu" className="shelf pb-16 pt-[14svh]">
        <p className="max-w-[34ch] text-lead">
          Chọn món bạn thích, phần còn lại Shopee lo.
        </p>
        <div className="mt-6">
          <Button asChild size="sm">
            <Link href="/san-pham">Vào showroom</Link>
          </Button>
        </div>
      </section>
    </>
  );
}

function dedupe(products: ProductCardView[]): ProductCardView[] {
  const seen = new Set<string>();
  return products.filter((product) => {
    if (seen.has(product.id)) return false;
    seen.add(product.id);
    return true;
  });
}
