'use client';

import * as ProgressPrimitive from '@radix-ui/react-progress';

import { cn } from '@/lib/utils';

/**
 * Thanh "dung tích còn lại" của món pre-loved: cao 4px, một màu nhấn, không
 * nhãn số bên trong (số nằm ở dòng tình trạng).
 */
export function RemainingBar({ value, className }: { value: number; className?: string }) {
  const clamped = Math.min(100, Math.max(0, value));
  return (
    <ProgressPrimitive.Root
      value={clamped}
      aria-label={`Còn lại ${clamped}%`}
      className={cn('h-1 w-full overflow-hidden rounded-full bg-ink/10', className)}
    >
      <ProgressPrimitive.Indicator
        className="h-full bg-accent transition-[width] duration-700 ease-out"
        style={{ width: `${clamped}%` }}
      />
    </ProgressPrimitive.Root>
  );
}
