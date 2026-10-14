import type { Metadata } from 'next';
import { Newsreader, Work_Sans } from 'next/font/google';
import type { ReactNode } from 'react';

import { SiteFooter } from '@/components/site-footer';
import { SiteHeader } from '@/components/site-header';
import { Providers } from './providers';
import './globals.css';

/**
 * Cặp chữ lấy từ thư viện của taste skill (class `serif-display` + `grotesk-light`):
 * Newsreader có trục quang học (optical size) nên đứng được cả ở cỡ 56px lẫn
 * cỡ 17px, Work Sans giữ vai trò mặt chữ UI. Cả hai đều có subset tiếng Việt,
 * và không nằm trong danh sách mặt chữ mặc định mà skill cấm.
 */
const display = Newsreader({
  subsets: ['latin', 'vietnamese'],
  weight: ['400', '500'],
  variable: '--font-display',
  display: 'swap',
});

const sans = Work_Sans({
  subsets: ['latin', 'vietnamese'],
  variable: '--font-sans',
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: 'Thanh Nhàn Cosmetic · Showroom mỹ phẩm',
    template: '%s · Thanh Nhàn Cosmetic',
  },
  description:
    'Showroom mỹ phẩm chính hãng: hàng mới nguyên seal và pre-loved tuyển chọn đã kiểm định. Giao dịch an toàn trên Shopee.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="vi" className={`${display.variable} ${sans.variable}`}>
      <body>
        <Providers>
          <SiteHeader />
          <main id="noi-dung">{children}</main>
          <SiteFooter />
        </Providers>
      </body>
    </html>
  );
}
