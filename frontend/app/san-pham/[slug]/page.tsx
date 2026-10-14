import type { Metadata } from 'next';
import Link from 'next/link';

import { BuyButton } from '@/components/domain/buy-button';
import { ProductGallery } from '@/components/domain/product-gallery';
import { QaList } from '@/components/domain/qa-list';
import { Tag } from '@/components/ui/tag';
import { ApiError, catalogApi } from '@/lib/api';
import { formatDate, formatPriceRange } from '@/lib/format';
import { productTags } from '@/lib/labels';
import type { ProductDetailView } from '@/lib/types';

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  try {
    const product = await catalogApi.product(slug);
    return {
      title: product.title,
      description:
        product.blurb ??
        `${product.title} · ${product.collectionTitle} tại showroom Thanh Nhàn Cosmetic.`,
    };
  } catch {
    return { title: 'Sản phẩm' };
  }
}

export default async function ProductPage({ params }: PageProps) {
  const { slug } = await params;

  let product: ProductDetailView;
  try {
    product = await catalogApi.product(slug);
  } catch (error) {
    const code = error instanceof ApiError ? error.code : undefined;
    if (code === 'PRODUCT_UNLISTED') return <UnavailableState />;
    return <MissingState />;
  }

  const price = formatPriceRange(product.price, product.priceMin, product.priceMax);
  const tags = productTags({ collection: product.collection, condition: product.condition });

  return (
    <article className="shelf pb-24 pt-10">
      <Link href={`/san-pham?collection=${product.collection}`} className="text-note text-ink-soft hover:text-ink">
        ← {product.collectionTitle}
      </Link>

      <div className="mt-8 grid gap-x-16 gap-y-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)]">
        <div className="lg:sticky lg:top-8 lg:self-start">
          <ProductGallery images={product.images} title={product.title} />
        </div>

        <div className="flex flex-col gap-10">
          <header>
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                {tags.map((tag) => (
                  <Tag key={tag}>{tag}</Tag>
                ))}
              </div>
            )}
            <h1 className="mt-4 font-display text-title">{product.title}</h1>
            {product.blurb && <p className="mt-5 text-ink-soft">{product.blurb}</p>}

            <p className="mt-8 text-lead tabular-nums">
              {price ? price.display : 'Giá theo gian hàng Shopee'}
            </p>
            <p className="mt-2 text-note text-ink-soft">
              Giá tham khảo, đồng bộ từ Shopee. Giao dịch theo giá trên Shopee.
            </p>
          </header>

          <BuyButton buyPath={product.buyPath} purchaseState={product.purchaseState} />

          <section aria-labelledby="qa-heading">
            <h2 id="qa-heading" className="font-display text-title">
              Vì sao bạn có thể yên tâm
            </h2>
            <div className="mt-6">
              <QaList qa={product.qa} />
            </div>
          </section>

          <section aria-labelledby="shopee-heading">
            <h2 id="shopee-heading" className="font-display text-title">
              Dữ liệu từ gian hàng Shopee
            </h2>
            {product.shopee ? (
              <dl className="mt-5 grid grid-cols-2 gap-4 text-note">
                <div>
                  <dt className="text-ink-soft">Mã sản phẩm</dt>
                  <dd className="tabular-nums">{product.shopee.itemId}</dd>
                </div>
                <div>
                  <dt className="text-ink-soft">Tồn kho</dt>
                  <dd className="tabular-nums">
                    {product.shopee.stock === null ? 'Theo gian hàng' : product.shopee.stock}
                  </dd>
                </div>
                <div>
                  <dt className="text-ink-soft">Đồng bộ lần cuối</dt>
                  <dd>{formatDate(product.shopee.syncedAt) ?? 'Chưa rõ'}</dd>
                </div>
                <div>
                  <dt className="text-ink-soft">Trạng thái</dt>
                  <dd>{product.purchaseState === 'ON_SALE' ? 'Đang bán' : 'Tạm ngừng bán'}</dd>
                </div>
              </dl>
            ) : (
              <p className="mt-5 text-note text-ink-soft">
                Món này không có listing riêng trên Shopee; nút mua dẫn tới kênh liên hệ của showroom.
              </p>
            )}
          </section>
        </div>
      </div>
    </article>
  );
}

function UnavailableState() {
  return (
    <section className="shelf py-32">
      <h1 className="font-display text-title">Món này đã tạm ngừng bán</h1>
      <p className="mt-4 max-w-reading text-ink-soft">
        Sản phẩm đã được đưa ra khỏi gian hàng Shopee nên showroom cũng đóng lại. Bộ sưu tập vẫn còn
        nhiều món khác đang bán.
      </p>
      <Link href="/san-pham" className="link-underline mt-8 inline-block">
        Xem toàn bộ showroom
      </Link>
    </section>
  );
}

function MissingState() {
  return (
    <section className="shelf py-32">
      <h1 className="font-display text-title">Không tìm thấy sản phẩm</h1>
      <p className="mt-4 max-w-reading text-ink-soft">
        Đường dẫn có thể sai, hoặc món này chưa được đăng lên showroom.
      </p>
      <Link href="/san-pham" className="link-underline mt-8 inline-block">
        Xem toàn bộ showroom
      </Link>
    </section>
  );
}
