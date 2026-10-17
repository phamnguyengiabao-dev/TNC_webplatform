export default function SocialGalleryLoading() {
  return (
    <section className="shelf pb-24 pt-10" aria-label="Đang tải thư viện ảnh" aria-busy="true">
      <div className="h-12 w-3/4 max-w-2xl bg-field" />
      <div className="mt-6 h-5 w-full max-w-xl bg-field-soft" />
      <div className="mt-16 grid grid-cols-1 gap-10 sm:grid-cols-2 sm:gap-16">
        {[0, 1].map((item) => <div key={item} className="aspect-[4/5] bg-field" />)}
      </div>
    </section>
  );
}
