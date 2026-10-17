import type { Metadata } from 'next';

import { socialMediaApi } from '@/lib/api';

export const metadata: Metadata = {
  title: 'Thư viện ảnh',
  description: 'Ảnh và bài đăng được Thanh Nhàn Cosmetic tuyển chọn từ Facebook và Instagram.',
};

export const dynamic = 'force-dynamic';

export default async function SocialGalleryPage() {
  try {
    const { items } = await socialMediaApi.publicItems();
    return (
      <article className="shelf pb-24 pt-10">
        <section className="social-gallery-intro" aria-labelledby="social-gallery-title">
          <h1 id="social-gallery-title" className="font-display text-display">Những khoảnh khắc của TNC</h1>
          <p className="mt-6 max-w-reading text-body text-ink-soft">
            Ảnh được chọn từ Facebook và Instagram của Thanh Nhàn Cosmetic. Mỗi bài đăng chỉ xuất hiện sau khi đội ngũ duyệt.
          </p>
        </section>
        {items.length ? (
          <ul className="social-gallery-grid mt-16" aria-label="Ảnh đã được duyệt">
            {items.map((item) => (
              <li className="social-gallery-item" key={item.id}>
                <a href={item.permalink ?? '#'} target="_blank" rel="noreferrer noopener" className="group block" aria-label={`Xem bài đăng ${item.platform === 'FACEBOOK' ? 'Facebook' : 'Instagram'}`}>
                  <div className="social-gallery-images">
                    {item.mediaUrls.map((url, index) => <div className="social-gallery-image" key={url}>
                      {/* Meta CDN hosts rotate, so use the browser image element instead of a fixed Next image allowlist. */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={url} alt={`${item.caption?.slice(0, 100) || 'Ảnh từ Thanh Nhàn Cosmetic'}${item.mediaUrls.length > 1 ? ` · ảnh ${index + 1}` : ''}`} loading="lazy" />
                    </div>)}
                  </div>
                  <div className="mt-4 flex items-baseline justify-between gap-4">
                    <span className="text-note">{item.platform === 'FACEBOOK' ? 'Facebook' : 'Instagram'}</span>
                    <time className="text-note text-ink-soft" dateTime={item.publishedAt ?? undefined}>
                      {item.publishedAt ? new Intl.DateTimeFormat('vi-VN', { dateStyle: 'medium' }).format(new Date(item.publishedAt)) : ''}
                    </time>
                  </div>
                  {item.caption && <p className="mt-2 line-clamp-3 text-note">{item.caption}</p>}
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <section className="mt-24 bg-field-soft px-6 py-10" aria-live="polite">
            <h2 className="font-display text-title">Thư viện đang được tuyển chọn</h2>
            <p className="mt-4 text-body text-ink-soft">Ảnh mới sẽ xuất hiện sau khi đội ngũ chọn và duyệt.</p>
          <a className="link-underline mt-6 inline-block" href="/san-pham">Khám phá showroom</a>
          </section>
        )}
      </article>
    );
  } catch {
    return (
      <article className="shelf pb-24 pt-10" role="alert">
        <h1 className="font-display text-title">Chưa tải được thư viện ảnh</h1>
        <p className="mt-4 text-body text-ink-soft">Vui lòng thử tải lại trang sau ít phút.</p>
        <a className="link-underline mt-5 inline-block" href="/thu-vien-anh">Thử tải lại</a>
      </article>
    );
  }
}
