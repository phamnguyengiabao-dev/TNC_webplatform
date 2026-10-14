'use client';

import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import Link from 'next/link';
import { useState } from 'react';

import { collectionTheme } from '@/lib/labels';
import type { CollectionView } from '@/lib/types';
import { cn } from '@/lib/utils';

/**
 * "One live thing" của trang chủ: chọn dòng hàng và nội dung đổi ngay tại chỗ.
 * Chạy được bằng ngón tay trên điện thoại, và khi JavaScript tắt thì hai tab
 * vẫn là hai liên kết thật dẫn tới đúng bộ sưu tập.
 */
export function CollectionShowcase({ collections }: { collections: CollectionView[] }) {
  const reduced = useReducedMotion();
  const [activeSlug, setActiveSlug] = useState(collections[0]?.slug ?? '');
  const active = collections.find((entry) => entry.slug === activeSlug) ?? collections[0];

  if (!active) return null;
  const theme = collectionTheme(active.slug, active.theme);

  return (
    <section aria-labelledby="showcase-heading">
      <div className="flex flex-wrap gap-x-8 gap-y-2">
        {collections.map((entry) => (
          <button
            key={entry.slug}
            type="button"
            onClick={() => setActiveSlug(entry.slug)}
            aria-pressed={entry.slug === active.slug}
            className={cn(
              'text-lead transition-colors',
              entry.slug === active.slug ? 'text-ink' : 'text-ink/40 hover:text-ink/70',
            )}
          >
            {entry.title}
          </button>
        ))}
      </div>

      <div className="mt-10 min-h-[13rem]">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={active.slug}
            initial={reduced ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: reduced ? 0 : -6 }}
            transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 300, damping: 32 }}
          >
            <h3 id="showcase-heading" className="font-display text-title">
              {active.title}
            </h3>
            <p className="mt-6 max-w-[34ch] text-ink-soft">{theme.note}</p>
            <p className="mt-4 text-note text-ink-soft">
              {active.productCount > 0
                ? `${active.productCount} món đang trên kệ`
                : 'Đang được staff tuyển chọn thêm'}
            </p>
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="mt-10 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Link
          href={`/san-pham?collection=${active.slug}`}
          className="flex h-[72px] items-center justify-center rounded-md bg-ink text-paper transition-opacity hover:opacity-90"
        >
          Xem bộ sưu tập
        </Link>
        <a
          href="#kiem-dinh"
          className="flex h-[72px] items-center justify-center rounded-md bg-field text-ink transition-colors hover:bg-ink/10"
        >
          Cách chúng tôi kiểm định
        </a>
      </div>
    </section>
  );
}
