'use client';

import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import Image from 'next/image';
import { useCallback, useEffect, useState } from 'react';

import { cn } from '@/lib/utils';

interface Origin {
  x: number;
  y: number;
}

/**
 * Gallery 4:5 của PDP: đổi ảnh bằng crossfade, bấm để soi ở chế độ zoom.
 *
 * ZOOM là yêu cầu nghiệp vụ, không phải hiệu ứng: khách phải đọc được vạch
 * dung tích còn lại, batch code và tình trạng seal in trên bao bì. Vì vậy ảnh
 * zoom hiển thị ở kích thước gốc (object-contain) và lấy điểm bấm làm tâm phóng.
 */
export function ProductGallery({
  images,
  title,
  className,
}: {
  images: string[];
  title: string;
  className?: string;
}) {
  const [index, setIndex] = useState(0);
  const [zoomed, setZoomed] = useState(false);
  const [origin, setOrigin] = useState<Origin>({ x: 50, y: 50 });
  const reduced = useReducedMotion();

  const hasImages = images.length > 0;
  const current = hasImages ? images[Math.min(index, images.length - 1)] : null;

  const step = useCallback(
    (delta: number) => {
      if (images.length < 2) return;
      setIndex((previous) => (previous + delta + images.length) % images.length);
    },
    [images.length],
  );

  useEffect(() => {
    if (!zoomed) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setZoomed(false);
      if (event.key === 'ArrowRight') step(1);
      if (event.key === 'ArrowLeft') step(-1);
    };
    window.addEventListener('keydown', onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [zoomed, step]);

  return (
    <div className={cn('flex flex-col gap-4', className)}>
      <button
        type="button"
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          setOrigin({
            x: ((event.clientX - rect.left) / rect.width) * 100,
            y: ((event.clientY - rect.top) / rect.height) * 100,
          });
          setZoomed(true);
        }}
        disabled={!current}
        aria-label={current ? `Phóng to ảnh: ${title}` : 'Chưa có ảnh'}
        className="relative block aspect-[4/5] w-full overflow-hidden rounded-card bg-field"
      >
        <AnimatePresence mode="wait" initial={false}>
          {current ? (
            <motion.span
              key={current}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={reduced ? { duration: 0 } : { duration: 0.5, ease: 'easeOut' }}
              className="absolute inset-0"
            >
              <Image
                src={current}
                alt={`${title}, ảnh ${index + 1}/${images.length}`}
                fill
                priority
                sizes="(min-width: 1024px) 46vw, 92vw"
                className="object-cover"
              />
            </motion.span>
          ) : (
            <span className="flex h-full items-center justify-center px-8 text-center text-ink-soft">
              Ảnh thật của món này sẽ được cập nhật sau khi staff kiểm định.
            </span>
          )}
        </AnimatePresence>

        {current && (
          <span className="absolute bottom-4 right-4 rounded-full bg-paper px-3 py-1 text-small text-ink">
            Bấm để soi kỹ · {index + 1}/{images.length}
          </span>
        )}
      </button>

      {images.length > 1 && (
        <div className="flex gap-3 overflow-x-auto pb-1">
          {images.map((image, position) => (
            <button
              key={image}
              type="button"
              onClick={() => setIndex(position)}
              aria-label={`Xem ảnh ${position + 1}`}
              aria-current={position === index}
              className={cn(
                'relative h-20 w-16 shrink-0 overflow-hidden rounded-md bg-field',
                position === index ? 'outline outline-2 outline-offset-2 outline-accent' : 'opacity-70',
              )}
            >
              <Image src={image} alt="" fill sizes="64px" className="object-cover" />
            </button>
          ))}
        </div>
      )}

      <AnimatePresence>
        {zoomed && current && (
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={`Ảnh phóng to: ${title}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={reduced ? { duration: 0 } : { duration: 0.25 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-ink/95 p-4"
            onClick={() => setZoomed(false)}
          >
            <motion.div
              initial={reduced ? false : { scale: 0.96 }}
              animate={{ scale: 1 }}
              transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 260, damping: 30 }}
              className="relative h-full w-full"
            >
              <Image
                src={current}
                alt={`${title}, ảnh phóng to`}
                fill
                sizes="100vw"
                className="object-contain"
                style={{ transformOrigin: `${origin.x}% ${origin.y}%` }}
              />
            </motion.div>
            <button
              type="button"
              onClick={() => setZoomed(false)}
              className="absolute right-6 top-6 rounded-full bg-paper px-4 py-2 text-note text-ink"
            >
              Đóng (Esc)
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
