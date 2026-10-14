import { ProductCard } from '@/components/domain/product-card';
import type { ProductCardView } from '@/lib/types';
import { cn } from '@/lib/utils';

/**
 * VISUAL_DENSITY: low - tối đa 3 sản phẩm một hàng ở desktop, 2 ở tablet.
 * Ảnh đủ lớn để soi món pre-loved ngay trên lưới.
 */
export function ProductGrid({
  products,
  className,
}: {
  products: ProductCardView[];
  className?: string;
}) {
  return (
    <div
      className={cn('grid grid-cols-1 gap-x-8 gap-y-14 sm:grid-cols-2 lg:grid-cols-3', className)}
    >
      {products.map((product) => (
        <ProductCard key={product.id} product={product} />
      ))}
    </div>
  );
}
