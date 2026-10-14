import Link from 'next/link';
import type { ReactNode } from 'react';

import { Skeleton } from '@/components/ui/skeleton';
import { errorCopy } from '@/lib/labels';

/** Skeleton của lưới sản phẩm: giữ đúng nhịp lưới để trang không nhảy. */
export function ProductGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-x-8 gap-y-14 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: count }).map((_, index) => (
        <div key={index}>
          <Skeleton className="aspect-[4/5] w-full rounded-card" />
          <Skeleton className="mt-5 h-4 w-24" />
          <Skeleton className="mt-3 h-5 w-3/4" />
          <Skeleton className="mt-2 h-4 w-1/3" />
        </div>
      ))}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-card bg-field px-8 py-20 text-center">
      <h2 className="font-display text-title">{title}</h2>
      <p className="mx-auto mt-3 max-w-reading text-ink-soft">{description}</p>
      {action && <div className="mt-8 flex justify-center">{action}</div>}
    </div>
  );
}

/**
 * Trạng thái lỗi: câu chữ lấy từ bảng dịch theo `code` của backend, kèm một
 * hành động cụ thể - không bao giờ hiển thị tiếng Anh hay mã lỗi trần.
 */
export function ErrorState({
  code,
  onRetry,
  retryLabel,
  backHref = '/san-pham',
}: {
  code?: string;
  onRetry?: () => void;
  retryLabel?: string;
  backHref?: string;
}) {
  const copy = errorCopy(code);
  return (
    <div className="rounded-card bg-field px-8 py-20 text-center">
      <h2 className="font-display text-title">{copy.message}</h2>
      <div className="mt-8 flex justify-center gap-6 text-note">
        {onRetry ? (
          <button type="button" onClick={onRetry} className="link-underline">
            {retryLabel ?? copy.action}
          </button>
        ) : (
          <Link href={backHref} className="link-underline">
            {copy.action}
          </Link>
        )}
      </div>
    </div>
  );
}
