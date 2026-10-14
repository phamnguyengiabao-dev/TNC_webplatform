import Link from 'next/link';

export function SiteFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="shelf pb-10 pt-24">
      <div className="grid grid-cols-1 gap-4 text-note text-ink-soft sm:grid-cols-[1fr_auto_1fr] sm:items-center">
        <p>Showroom mỹ phẩm Thanh Nhàn</p>
        <nav className="flex flex-wrap gap-6 sm:justify-center">
          <Link href="/san-pham" className="text-ink hover:underline">
            Bộ sưu tập
          </Link>
          <Link href="/san-pham?collection=curated-preloved" className="text-ink hover:underline">
            Pre-loved
          </Link>
          <Link href="/anh-tu-lieu" className="text-ink hover:underline">
            Nguồn ảnh tư liệu
          </Link>
        </nav>
        <p className="sm:text-right">© {year} · Giao dịch trên Shopee</p>
      </div>
    </footer>
  );
}
