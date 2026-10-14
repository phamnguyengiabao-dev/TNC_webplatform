'use client';

import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import Image from 'next/image';
import { useEffect, useState } from 'react';

export interface StagePhoto {
  src: string;
  alt: string;
  caption: string;
}

const HOLD_MS = 6000;

/**
 * Nửa cố định của "split stage": một tấm ảnh đứng yên suốt lượt xem, lặng lẽ
 * đổi ảnh như ánh sáng chuyển trong phòng. Đây là chuyển động chữ ký của
 * trang, nên nó là thứ duy nhất được phép chậm và rộng.
 *
 * Tạm dừng khi tab bị ẩn; dưới prefers-reduced-motion chỉ hiển thị ảnh đầu.
 */
export function StickyPhoto({ photos }: { photos: StagePhoto[] }) {
  const reduced = useReducedMotion();
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (reduced || photos.length < 2) return;
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      timer ??= setInterval(() => setIndex((previous) => (previous + 1) % photos.length), HOLD_MS);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    const onVisibility = () => (document.hidden ? stop() : start());

    start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [photos.length, reduced]);

  const current = photos[index];

  return (
    <div className="relative h-[60svh] overflow-hidden rounded-card bg-field lg:h-[calc(100svh-24px)] lg:sticky lg:top-3">
      <AnimatePresence initial={false}>
        <motion.div
          key={current.src}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduced ? 0 : 1.6, ease: 'easeInOut' }}
          className="absolute inset-0"
        >
          <Image
            src={current.src}
            alt={current.alt}
            fill
            priority={index === 0}
            sizes="(min-width: 1024px) 50vw, 100vw"
            className="object-cover"
          />
        </motion.div>
      </AnimatePresence>

      <p className="absolute inset-x-0 bottom-0 flex min-h-14 items-center bg-paper px-6 py-3 text-note leading-snug text-ink-soft">
        {current.caption}
      </p>
    </div>
  );
}
