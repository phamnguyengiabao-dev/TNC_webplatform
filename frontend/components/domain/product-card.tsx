import Image from 'next/image';
import Link from 'next/link';

import { RemainingBar } from '@/components/ui/progress';
import { Tag } from '@/components/ui/tag';
import { formatPriceRange } from '@/lib/format';
import { PURCHASE_STATE_LABELS, productTags } from '@/lib/labels';
import type { ProductCardView } from '@/lib/types';

/**
 * Card sản phẩm: ảnh thật là nhân vật chính, phần chữ chỉ để quét nhanh tình
 * trạng. Không bóng đổ, không khung dashboard - chỉ đường mảnh và khoảng thở.
 */
export function ProductCard({ product }: { product: ProductCardView }) {
  const price = formatPriceRange(product.price, product.priceMin, product.priceMax);
  const tags = productTags({ collection: product.collection, condition: product.condition });
  const percentLeft = product.condition.percentLeft;

  return (
    <article className="group">
      <Link href={`/san-pham/${product.slug}`} className="block">
        <div className="relative aspect-[4/5] w-full overflow-hidden rounded-card bg-field">
          {product.image ? (
            <Image
              src={product.image}
              alt={product.title}
              fill
              sizes="(min-width: 1024px) 33vw, (min-width: 640px) 45vw, 90vw"
              className="object-cover transition-transform duration-700 ease-out group-hover:scale-[1.03]"
            />
          ) : (
            <div className="flex h-full items-center justify-center px-6 text-center text-note text-ink-soft">
              Chưa có ảnh cho sản phẩm này
            </div>
          )}
          {product.purchaseState !== 'ON_SALE' && (
            <span className="absolute left-4 top-4 rounded-full bg-paper px-3 py-1 text-small text-ink">
              {PURCHASE_STATE_LABELS[product.purchaseState]}
            </span>
          )}
        </div>

        <div className="pt-5">
          {tags.length > 0 && (
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {tags.map((tag) => (
                <Tag key={tag}>{tag}</Tag>
              ))}
            </div>
          )}

          <h3 className="mt-3 font-display text-lead leading-snug">{product.title}</h3>

          <p className="mt-2 text-note text-ink">
            {price ? (
              <>
                {price.display}
                <span className="ml-2 text-ink-soft">· giá tham khảo</span>
              </>
            ) : (
              <span className="text-ink-soft">Giá theo gian hàng Shopee</span>
            )}
          </p>
        </div>
      </Link>

      {percentLeft !== null && (
        <div className="mt-4 flex items-center gap-3" aria-hidden={false}>
          <RemainingBar value={percentLeft} />
          <span className="shrink-0 text-small tabular-nums text-ink-soft">
            {percentLeft}%
          </span>
        </div>
      )}
    </article>
  );
}
