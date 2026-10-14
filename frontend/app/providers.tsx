'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';

/**
 * TanStack Query cho các tương tác ở client (đổi tab bộ sưu tập, tải thêm).
 * Dữ liệu đầu tiên luôn do server component nạp sẵn và truyền xuống làm
 * `initialData`, nên không có màn hình nào phải chờ ở trạng thái rỗng.
 */
export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60_000,
            retry: 1,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
