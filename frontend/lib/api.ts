import type {
  ApiProblem,
  CatalogQuery,
  CollectionList,
  ProductDetailView,
  ProductPage,
  SocialMediaList,
} from './types';

/** Lỗi có `code` ổn định - UI dịch qua bảng nhãn, không hiển thị tiếng Anh. */
export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly requestId?: string;

  constructor(problem: ApiProblem) {
    super(problem.title);
    this.name = 'ApiError';
    this.code = problem.code;
    this.status = problem.status;
    this.requestId = problem.requestId;
  }
}

export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1').replace(
  /\/+$/,
  '',
);

/** Catalog đổi khi admin publish bài mới: 60 giây là đủ tươi mà vẫn tĩnh. */
const REVALIDATE_SECONDS = 60;

interface FetchOptions {
  /** `0` = luôn gọi mạng (dùng cho load-more ở client). */
  revalidate?: number;
  signal?: AbortSignal;
}

async function apiGet<T>(path: string, options: FetchOptions = {}): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    headers: { accept: 'application/json' },
    next: { revalidate: options.revalidate ?? REVALIDATE_SECONDS },
    signal: options.signal,
  });

  if (!response.ok) {
    throw new ApiError(await readProblem(response));
  }
  return (await response.json()) as T;
}

async function readProblem(response: Response): Promise<ApiProblem> {
  try {
    const body = (await response.json()) as Partial<ApiProblem>;
    return {
      type: body.type ?? 'about:blank',
      title: body.title ?? response.statusText,
      status: body.status ?? response.status,
      code: body.code ?? `HTTP_${response.status}`,
      detail: body.detail,
      requestId: body.requestId,
    };
  } catch {
    return {
      type: 'about:blank',
      title: response.statusText,
      status: response.status,
      code: `HTTP_${response.status}`,
    };
  }
}

export function toQueryString(query: CatalogQuery): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }
  const serialised = params.toString();
  return serialised.length > 0 ? `?${serialised}` : '';
}

export const catalogApi = {
  collections: (options?: FetchOptions) =>
    apiGet<CollectionList>('/catalog/collections', options),

  products: (query: CatalogQuery = {}, options?: FetchOptions) =>
    apiGet<ProductPage>(`/catalog/products${toQueryString(query)}`, {
      ...options,
      revalidate: query.cursor ? 0 : options?.revalidate,
    }),

  product: (slug: string, options?: FetchOptions) =>
    apiGet<ProductDetailView>(`/catalog/products/${encodeURIComponent(slug)}`, options),
};

export const socialMediaApi = {
  publicItems: () => apiGet<SocialMediaList>('/social-media'),
};
