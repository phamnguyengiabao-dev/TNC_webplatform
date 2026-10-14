import { cn } from '@/lib/utils';

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-breathe rounded-md bg-field', className)} aria-hidden />;
}
