'use client';

import { useInfiniteQuery } from '@tanstack/react-query';
import { motion, useReducedMotion } from 'framer-motion';
import { useState } from 'react';

import { CollectionTabs } from '@/components/domain/collection-tabs';
import { ProductGrid } from '@/components/domain/product-grid';
import { EmptyState, ErrorState, ProductGridSkeleton } from '@/components/domain/states';
import { Button } from '@/components/ui/button';
import { ApiError, catalogApi } from '@/lib/api';
import type { CatalogSort, CollectionView, ProductCardView } from '@/lib/types';
import { cn } from '@/lib/utils';

const SORTS: Array<{ value: CatalogSort; label: string }> = [
  { value: 'newest', label: 'Mới lên kệ' },
  { value: 'price_asc', label: 'Giá thấp đến cao' },
  { value: 'price_desc', label: 'Giá cao đến thấp' },
];

interface InitialData {
  collection?: string;
  items: ProductCardView[];
  nextCursor: string | null;
}

/**
 * Trình duyệt bộ sưu tập: đổi tab là một lần chuyển mượt, không phải tải lại
 * trang; bộ lọc chỉ còn đúng hai thứ đáng dùng (thứ tự và còn hàng) thay vì
 * một sidebar checkbox.
 */
export function CatalogBrowser({
  collections,
  initial,
}: {
  collections: CollectionView[];
  initial: InitialData;
}) {
  const reduced = useReducedMotion();
  const [collection, setCollection] = useState<string | undefined>(initial.collection);
  const [sort, setSort] = useState<CatalogSort>('newest');
  const [inStock, setInStock] = useState(false);

  const isInitialQuery =
    collection === initial.collection && sort === 'newest' && inStock === false;

  const query = useInfiniteQuery({
    queryKey: ['catalog', collection ?? 'all', sort, inStock],
    queryFn: ({ pageParam }) =>
      catalogApi.products(
        {
          collection,
          sort,
          in_stock: inStock ? true : undefined,
          cursor: pageParam,
        },
        { revalidate: 0 },
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    initialData: isInitialQuery
      ? { pages: [{ items: initial.items, nextCursor: initial.nextCursor }], pageParams: [undefined] }
      : undefined,
  });

  const products = query.data?.pages.flatMap((page) => page.items) ?? [];
  const errorCode = query.error instanceof ApiError ? query.error.code : undefined;

  const tabs = [
    { slug: 'all', title: 'Toàn bộ showroom' },
    ...collections.map((entry) => ({
      slug: entry.slug,
      title: entry.title,
      count: entry.productCount,
    })),
  ];

  return (
    <section className="shelf pb-24">
      <div className="flex flex-col gap-6 pb-10 lg:flex-row lg:items-end lg:justify-between">
        <CollectionTabs
          tabs={tabs}
          value={collection ?? 'all'}
          onChange={(slug) => setCollection(slug === 'all' ? undefined : slug)}
        />

        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 text-note">
          <div className="flex items-center gap-4">
            {SORTS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setSort(option.value)}
                className={cn(
                  'transition-colors',
                  sort === option.value ? 'text-ink' : 'text-ink-soft hover:text-ink',
                )}
                aria-pressed={sort === option.value}
              >
                {option.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setInStock((previous) => !previous)}
            aria-pressed={inStock}
            className={cn('transition-colors', inStock ? 'text-ink' : 'text-ink-soft hover:text-ink')}
          >
            Chỉ còn hàng
          </button>
        </div>
      </div>

      <div className="pt-14">
        {query.isPending ? (
          <ProductGridSkeleton />
        ) : query.isError ? (
          <ErrorState code={errorCode} onRetry={() => void query.refetch()} />
        ) : products.length === 0 ? (
          <EmptyState
            title="Chưa có món nào ở đây"
            description="Bộ sưu tập này đang được staff tuyển chọn thêm. Bạn thử bỏ bộ lọc hoặc xem bộ sưu tập còn lại nhé."
            action={
              <Button
                variant="surface"
                onClick={() => {
                  setCollection(undefined);
                  setSort('newest');
                  setInStock(false);
                }}
              >
                Xem toàn bộ showroom
              </Button>
            }
          />
        ) : (
          <motion.div
            key={`${collection ?? 'all'}-${sort}-${inStock}`}
            initial={reduced ? false : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 260, damping: 32 }}
          >
            <ProductGrid products={products} />

            {query.hasNextPage && (
              <div className="mt-20 flex justify-center">
                <Button
                  variant="surface"
                  onClick={() => void query.fetchNextPage()}
                  disabled={query.isFetchingNextPage}
                >
                  {query.isFetchingNextPage ? 'Đang tải…' : 'Tải thêm sản phẩm'}
                </Button>
              </div>
            )}
          </motion.div>
        )}
      </div>
    </section>
  );
}
