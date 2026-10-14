import type { Metadata } from 'next';
import Link from 'next/link';

import { IMAGE_CREDITS } from '@/lib/credits';

export const metadata: Metadata = {
  title: 'Nguồn ảnh tư liệu',
  description:
    'Giấy phép và nguồn của những ảnh tư liệu xuất hiện trong showroom Thanh Nhàn Cosmetic.',
};

/**
 * Trang ghi nguồn ảnh: các giấy phép CC BY và CC BY-SA bắt buộc phải nêu tên
 * tác phẩm kèm liên kết tới nguồn, nên bảng này phải nằm ở một chỗ đọc được
 * thay vì nhồi vào một dòng chữ nhỏ ở footer.
 */
export default function ImageCreditsPage() {
  return (
    <article className="shelf pb-24 pt-10">
      <h1 className="font-display text-title">Nguồn ảnh tư liệu</h1>
      <p className="mt-5 max-w-reading text-ink-soft">
        Ảnh tư liệu dùng làm không khí cho showroom được lấy từ các bộ sưu tập mở; chúng không phải
        ảnh sản phẩm của TNC. Ảnh sản phẩm do staff chụp tại kho hoặc lấy từ gian hàng Shopee khi
        đồng bộ.
      </p>

      <ul className="mt-14 space-y-6">
        {IMAGE_CREDITS.map((credit) => (
          <li key={credit.file} className="grid gap-1 sm:grid-cols-[13rem_1fr] sm:gap-6">
            <span className="text-note text-ink-soft">{credit.licenseCode.toUpperCase()}</span>
            <span className="text-body leading-relaxed">
              {credit.title}.{' '}
              <a
                href={credit.page}
                className="link-underline"
                rel="noreferrer noopener"
                target="_blank"
              >
                Xem nguồn
              </a>
              .
            </span>
          </li>
        ))}
      </ul>

      <Link href="/" className="link-underline mt-16 inline-block text-note">
        Về trang chủ
      </Link>
    </article>
  );
}
