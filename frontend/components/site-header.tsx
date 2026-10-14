import Link from 'next/link';

/** Điều hướng tối giản: hai lối vào bộ sưu tập, không menu nhiều tầng. */
export function SiteHeader() {
  return (
    <header className="shelf flex items-baseline justify-between py-8">
      <Link href="/" className="font-display text-lead tracking-tight">
        Thanh Nhàn <span className="text-ink-soft">Cosmetic</span>
      </Link>
      <nav className="flex items-center gap-7 text-note">
        <Link href="/san-pham?collection=pristine-retail" className="hover:underline">
          Hàng mới
        </Link>
        <Link href="/san-pham?collection=curated-preloved" className="hover:underline">
          Pre-loved
        </Link>
        <Link href="/san-pham" className="link-underline">
          Toàn bộ showroom
        </Link>
      </nav>
    </header>
  );
}
