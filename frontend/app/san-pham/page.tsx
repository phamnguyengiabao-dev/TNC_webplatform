import type { Metadata } from 'next';

import { ErrorState } from '@/components/domain/states';
import { ApiError, catalogApi } from '@/lib/api';
import { collectionTheme } from '@/lib/labels';
import { CatalogBrowser } from './catalog-browser';

export const metadata: Metadata = {
  title: 'Bộ sưu tập',
  description:
    'Hàng mới nguyên seal và mỹ phẩm pre-loved đã kiểm định, tuyển chọn bởi Thanh Nhàn Cosmetic.',
};

export default async function CatalogPage({
  searchParams,
}: {
  searchParams: Promise<{ collection?: string }>;
}) {
  const { collection } = await searchParams;

  try {
    const [collections, page] = await Promise.all([
      catalogApi.collections(),
      catalogApi.products(collection ? { collection } : {}),
    ]);
    const active = collections.items.find((entry) => entry.slug === collection);
    const theme = collectionTheme(collection ?? '', active?.theme ?? null);

    return (
      <>
        <section className="shelf pb-10 pt-14">
          <h1 className="font-display text-title">
            {active ? active.title : 'Toàn bộ showroom'}
          </h1>
          <p className="mt-5 max-w-reading text-ink-soft">
            {active
              ? theme.note
              : 'Hai dòng hàng trong cùng một quầy: hàng mới nguyên seal, và mỹ phẩm pre-loved đã được staff kiểm định từng món.'}
          </p>
        </section>
        <CatalogBrowser
          collections={collections.items}
          initial={{ collection, items: page.items, nextCursor: page.nextCursor }}
        />
      </>
    );
  } catch (error) {
    const code = error instanceof ApiError ? error.code : undefined;
    return (
      <section className="shelf py-24">
        <ErrorState code={code} backHref="/" />
      </section>
    );
  }
}
