import Link from 'next/link';

export default function NotFound() {
  return (
    <section className="shelf py-32">
      <h1 className="font-display text-title">Không tìm thấy trang này</h1>
      <p className="mt-4 max-w-reading text-ink-soft">
        Đường dẫn có thể đã đổi, hoặc sản phẩm đã được đưa ra khỏi showroom. Bộ sưu tập hiện tại vẫn
        ở ngay đây.
      </p>
      <Link href="/san-pham" className="link-underline mt-8 inline-block">
        Xem toàn bộ showroom
      </Link>
    </section>
  );
}
