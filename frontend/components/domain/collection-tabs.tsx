'use client';

import { cn } from '@/lib/utils';

export interface CollectionTab {
  slug: string;
  title: string;
  count?: number;
}

/**
 * Chuyển bộ sưu tập bằng tab - không dùng checkbox ở sidebar.
 *
 * Trạng thái chọn nằm ở nền của chính nút (không phải một khối absolute đè
 * lên): nhờ vậy tương phản của nhãn luôn đo được, và việc đổi bộ sưu tập vẫn
 * mượt nhờ transition màu cộng với crossfade nội dung ở component cha.
 */
export function CollectionTabs({
  tabs,
  value,
  onChange,
  className,
}: {
  tabs: CollectionTab[];
  value: string;
  onChange: (slug: string) => void;
  className?: string;
}) {
  return (
    <div role="tablist" aria-label="Bộ sưu tập" className={cn('flex flex-wrap gap-2', className)}>
      {tabs.map((tab) => {
        const active = tab.slug === value;
        return (
          <button
            key={tab.slug}
            role="tab"
            type="button"
            aria-selected={active}
            onClick={() => onChange(tab.slug)}
            className={cn(
              'h-11 rounded-full px-5 text-note transition-colors duration-300',
              active ? 'bg-accent text-accent-ink' : 'text-ink-soft hover:text-ink',
            )}
          >
            <span className="flex items-center">
              {tab.title}
              {typeof tab.count === 'number' && (
                <span className={cn('ml-2 tabular-nums', active ? 'text-accent-ink/70' : 'text-ink-soft/70')}>
                  {tab.count}
                </span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}
