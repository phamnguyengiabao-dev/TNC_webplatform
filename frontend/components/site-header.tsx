import Link from 'next/link';

/** Điều hướng tối giản: hai lối vào bộ sưu tập, không menu nhiều tầng. */
export function SiteHeader() {
  return (
    <header className="shelf flex flex-wrap items-baseline justify-between gap-y-5 py-8">
      <Link href="/" className="shrink-0 font-display text-lead tracking-tight">
        Thanh Nhàn <span className="text-ink-soft">Cosmetic</span>
      </Link>
      <nav className="flex flex-wrap items-center gap-x-5 gap-y-2 text-note sm:gap-x-7">
        <Link href="/san-pham?collection=pristine-retail" className="hover:underline">
          Hàng mới
        </Link>
        <Link href="/san-pham?collection=curated-preloved" className="hover:underline">
          Pre-loved
        </Link>
        <Link href="/san-pham" className="link-underline">
          Toàn bộ showroom
        </Link>
        <Link href="/thu-vien-anh" className="hover:underline">
          Thư viện ảnh
        </Link>
      </nav>
    </header>
  );
}
