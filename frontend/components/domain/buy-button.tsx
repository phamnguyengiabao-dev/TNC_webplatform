import { Button } from '@/components/ui/button';
import { PURCHASE_STATE_LABELS } from '@/lib/labels';
import type { PurchaseState } from '@/lib/types';

/**
 * Nút mua deep-link sang Shopee. Dùng thẻ <a> thật (không phải onClick) để
 * hoạt động cả khi JavaScript tắt; backend ghi nhận click rồi 302 sang listing.
 * Thanh toán, vận chuyển và hoàn tiền đều do Shopee xử lý.
 */
export function BuyButton({
  buyPath,
  purchaseState,
  size = 'lg',
}: {
  buyPath: string;
  purchaseState: PurchaseState;
  size?: 'md' | 'lg';
}) {
  const onSale = purchaseState === 'ON_SALE';

  if (!onSale) {
    return (
      <p className="text-note text-ink-soft">
        {PURCHASE_STATE_LABELS[purchaseState]}. Bạn xem các sản phẩm tương tự ở bên dưới.
      </p>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
      <Button asChild size={size}>
        <a href={buyPath} target="_blank" rel="noopener noreferrer">
          Mua trên Shopee
        </a>
      </Button>
      <span className="text-note text-ink-soft">
        Thanh toán, vận chuyển và hoàn tiền do Shopee bảo vệ.
      </span>
    </div>
  );
}
