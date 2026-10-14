'use client';

import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * Hai hình dạng nút cho toàn trang: một nút mực đặc (hành động chính) và một
 * nút trên nền đá (hành động phụ). Không viền 1px, không gradient, không bóng:
 * bề mặt tách nhau bằng tông màu, đúng luật của taste skill.
 */
const button = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap font-sans text-body transition-colors disabled:cursor-not-allowed disabled:opacity-45',
  {
    variants: {
      variant: {
        solid: 'bg-accent text-accent-ink hover:bg-ink rounded-full',
        surface: 'bg-field text-ink hover:bg-field-strong rounded-full',
        bare: 'text-ink-soft hover:text-ink rounded-full',
      },
      size: {
        sm: 'h-10 px-[18px]',
        md: 'h-11 px-6',
        lg: 'h-12 px-7',
      },
    },
    defaultVariants: { variant: 'solid', size: 'md' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof button> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Component = asChild ? Slot : 'button';
    return <Component ref={ref} className={cn(button({ variant, size }), className)} {...props} />;
  },
);
Button.displayName = 'Button';
