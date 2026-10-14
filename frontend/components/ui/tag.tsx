import { cn } from '@/lib/utils';

/**
 * Nhãn tình trạng dạng chữ: [New In Box]. Không nền, không màu chói - đúng
 * yêu cầu "typographic badge, không phải banner" của design brief.
 */
export function Tag({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn('tag', className)}>{children}</span>;
}
