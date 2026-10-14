import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';

import { AppError } from '../../common/errors/app-error';
import { PrismaService } from '../../prisma/prisma.service';
import { decodeCursor, encodeCursor, type CatalogCursor } from './catalog.cursor';
import type { CatalogListQueryDto } from './dto/catalog-query.dto';
import { DEFAULT_NOT_SEEN_HIDE_DAYS, type CatalogSort } from './catalog.constants';
import { hideReasonFor, notSeenCutoff } from './catalog.policy';
import {
  PRODUCT_INCLUDE,
  resolveBuyUrl,
  toCardView,
  toDetailView,
  type BuyContext,
  type ProductCardView,
  type ProductDetailView,
  type ProductWithRelations,
} from './catalog.view';

export interface CatalogProductPage {
  items: ProductCardView[];
  nextCursor: string | null;
}

export interface CollectionView {
  slug: string;
  title: string;
  subtitle: string | null;
  theme: Record<string, unknown> | null;
  productCount: number;
}

export interface ClickContext {
  ip?: string;
  userAgent?: string;
  referrer?: string;
}

/**
 * Read model của showroom (docs/backend/SHOPEE_SHOWROOM_BACKEND.md 4.2).
 *
 * Không có mutation nào ngoài `OutboundClick`: giá, tồn kho và trạng thái bán
 * luôn đọc từ bản mirror Shopee, không bao giờ tính lại ở đây.
 */
@Injectable()
export class CatalogService {
  private readonly logger = new Logger(CatalogService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async listCollections(): Promise<CollectionView[]> {
    const now = new Date();
    const [collections, counts] = await Promise.all([
      this.prisma.collection.findMany({ orderBy: [{ sortOrder: 'asc' }, { slug: 'asc' }] }),
      this.prisma.product.groupBy({
        by: ['collectionId'],
        where: this.visibleWhere(now),
        _count: { _all: true },
      }),
    ]);

    const byCollection = new Map(counts.map((row) => [row.collectionId, row._count._all]));
    return collections.map((collection) => ({
      slug: collection.slug,
      title: collection.title,
      subtitle: collection.subtitle,
      theme: toPlainObject(collection.theme),
      productCount: byCollection.get(collection.id) ?? 0,
    }));
  }

  async listProducts(query: CatalogListQueryDto): Promise<CatalogProductPage> {
    const now = new Date();
    const sort: CatalogSort = query.sort ?? 'newest';
    const take = query.pageSize;
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;
    if (cursor && cursor.sort !== sort) {
      throw AppError.validation(
        `cursor was minted for sort=${cursor.sort} but the request asks for sort=${sort}`,
        'Cursor không khớp với kiểu sắp xếp, vui lòng tải lại danh sách.',
      );
    }

    const filters: Prisma.ProductWhereInput[] = [this.visibleWhere(now)];
    if (query.collection) filters.push({ collection: { slug: query.collection } });
    if (query.q) {
      const q = query.q.trim();
      if (q.length > 0) {
        filters.push({
          OR: [
            { displayTitle: { contains: q, mode: 'insensitive' } },
            { shopeeItem: { is: { itemName: { contains: q, mode: 'insensitive' } } } },
          ],
        });
      }
    }
    if (query.condition_min !== undefined) {
      filters.push({ conditionPercent: { gte: query.condition_min } });
    }
    if (query.price_min !== undefined) {
      filters.push({ shopeeItem: { is: { price: { gte: new Prisma.Decimal(query.price_min) } } } });
    }
    if (query.price_max !== undefined) {
      filters.push({ shopeeItem: { is: { price: { lte: new Prisma.Decimal(query.price_max) } } } });
    }
    if (query.wantsInStock === true) filters.push(inStockFilter());
    if (query.wantsInStock === false) filters.push({ NOT: inStockFilter() });
    if (cursor) filters.push(cursorWhere(sort, cursor));

    // take + 1: hàng thừa là tín hiệu còn trang sau, không cần COUNT.
    const rows = await this.prisma.product.findMany({
      where: { AND: filters },
      include: PRODUCT_INCLUDE,
      orderBy: orderByFor(sort),
      take: take + 1,
    });

    const hasMore = rows.length > take;
    const page = hasMore ? rows.slice(0, take) : rows;
    const last = page.at(-1);
    const buy = this.buyContext();

    return {
      items: page.map((row) => toCardView(row, buy)),
      nextCursor:
        hasMore && last ? encodeCursor({ sort, key: cursorKeyFor(sort, last), id: last.id }) : null,
    };
  }

  async getProductBySlug(slug: string): Promise<ProductDetailView> {
    const product = await this.prisma.product.findUnique({
      where: { slug },
      include: PRODUCT_INCLUDE,
    });
    if (!product || product.visibility === 'DRAFT') {
      throw AppError.notFound(`no published product with slug "${slug}"`);
    }
    this.assertVisible(product);
    return toDetailView(product, this.buyContext());
  }

  /**
   * Resolve deep-link Shopee cho nút mua và ghi nhận click.
   *
   * Trả URL thay vì tự redirect để controller `GET .../buy` (302) và endpoint
   * `POST .../click` (SPA) dùng chung đúng một đường nghiệp vụ.
   */
  async resolveBuyUrl(productId: string, click: ClickContext = {}): Promise<string> {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      include: PRODUCT_INCLUDE,
    });
    if (!product || product.visibility === 'DRAFT') {
      throw AppError.notFound(`no published product with id "${productId}"`);
    }
    this.assertVisible(product);

    const url = resolveBuyUrl(product, this.buyContext());
    if (!url) {
      throw new AppError('ITEM_NOT_LINKED', {
        logMessage: `product ${productId} has neither a Shopee item nor buyUrlOverride`,
      });
    }

    await this.recordClick(product.id, click);
    return url;
  }

  /** Ẩn/hiện theo policy sync: dùng chung cho read path và sync engine. */
  get hideAfterDays(): number {
    return this.config.get<number>('catalog.notSeenHideDays', DEFAULT_NOT_SEEN_HIDE_DAYS);
  }

  visibleWhere(now: Date): Prisma.ProductWhereInput {
    const cutoff = notSeenCutoff(now, this.hideAfterDays);
    return {
      visibility: 'PUBLISHED',
      OR: [
        { shopeeItemId: null },
        { shopeeItem: { is: { itemStatus: { in: ['NORMAL', 'UNLIST'] } } } },
        { shopeeItem: { is: { itemStatus: 'NOT_SEEN', lastSeenAt: { gte: cutoff } } } },
      ],
    };
  }

  private assertVisible(product: ProductWithRelations): void {
    const reason = hideReasonFor(product.shopeeItem, new Date(), this.hideAfterDays);
    if (product.visibility === 'HIDDEN_BY_SYNC' || reason) {
      throw new AppError('PRODUCT_UNLISTED', {
        logMessage: `product ${product.id} is not sellable (visibility=${product.visibility}, reason=${reason ?? 'none'})`,
        detail: 'Sản phẩm đã tạm ngừng bán trên showroom, vui lòng xem các sản phẩm khác.',
      });
    }
  }

  private async recordClick(productId: string, click: ClickContext): Promise<void> {
    const salt = this.config.get<string>('analytics.hashSalt', 'tnc-local-salt');
    try {
      await this.prisma.outboundClick.create({
        data: {
          productId,
          uaHash: hashSignal(salt, click.userAgent),
          ipHash: hashSignal(salt, click.ip),
          referrer: click.referrer?.slice(0, 500) ?? null,
        },
      });
    } catch (error) {
      // Mất một dòng analytics không được phép chặn khách mua hàng.
      this.logger.warn(
        `could not record outbound click for product ${productId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private buyContext(): BuyContext {
    return {
      apiOrigin: this.config.get<string>('app.publicApiOrigin', ''),
      storefrontBaseUrl: this.config.get<string>('shopee.storefrontBaseUrl', 'https://shopee.vn'),
      trackingSuffix: this.config.get<string>('shopee.trackingSuffix', ''),
    };
  }
}

/** Còn hàng = tồn kho chưa biết (null) hoặc > 0. */
function inStockFilter(): Prisma.ProductWhereInput {
  return {
    OR: [
      { shopeeItemId: null },
      { shopeeItem: { is: { stock: null } } },
      { shopeeItem: { is: { stock: { gt: 0 } } } },
    ],
  };
}

/** Nhóm "không có giá" - xếp cuối ở cả hai chiều sắp xếp. */
function nullPriceFilter(): Prisma.ProductWhereInput {
  return { OR: [{ shopeeItemId: null }, { shopeeItem: { is: { price: null } } }] };
}

function orderByFor(sort: CatalogSort): Prisma.ProductOrderByWithRelationInput[] {
  switch (sort) {
    case 'price_asc':
      return [{ shopeeItem: { price: { sort: 'asc', nulls: 'last' } } }, { id: 'asc' }];
    case 'price_desc':
      return [{ shopeeItem: { price: { sort: 'desc', nulls: 'last' } } }, { id: 'desc' }];
    case 'featured':
      return [{ featuredRank: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }];
    case 'newest':
    default:
      return [{ publishedAt: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }];
  }
}

/**
 * Mệnh đề keyset: phần còn lại của tập kết quả sau con trỏ.
 *
 * Mọi nhánh đều kết thúc bằng `id` làm tie-breaker, nên hai sản phẩm cùng giá
 * (hoặc cùng ngày publish) không bao giờ bị bỏ sót hay lặp giữa hai trang.
 */
function cursorWhere(sort: CatalogSort, cursor: CatalogCursor): Prisma.ProductWhereInput {
  switch (sort) {
    case 'featured': {
      if (cursor.key === null || cursor.key === '') {
        return { AND: [{ featuredRank: null }, { id: { gt: cursor.id } }] };
      }
      const rank = Number.parseInt(cursor.key, 10);
      if (!Number.isFinite(rank)) return { AND: [{ featuredRank: null }, { id: { gt: cursor.id } }] };
      return {
        OR: [
          { featuredRank: { gt: rank } },
          { featuredRank: rank, id: { gt: cursor.id } },
          { featuredRank: null },
        ],
      };
    }
    case 'price_asc':
      return priceCursorWhere(cursor, 'asc');
    case 'price_desc':
      return priceCursorWhere(cursor, 'desc');
    case 'newest':
    default: {
      const at = cursor.key ? new Date(cursor.key) : null;
      if (!at || Number.isNaN(at.getTime())) {
        return { AND: [{ publishedAt: null }, { id: { lt: cursor.id } }] };
      }
      return {
        OR: [
          { publishedAt: { lt: at } },
          { publishedAt: at, id: { lt: cursor.id } },
          { publishedAt: null },
        ],
      };
    }
  }
}

function priceCursorWhere(cursor: CatalogCursor, direction: 'asc' | 'desc'): Prisma.ProductWhereInput {
  const ascending = direction === 'asc';

  if (cursor.key === null || cursor.key === '') {
    return {
      AND: [nullPriceFilter(), ascending ? { id: { gt: cursor.id } } : { id: { lt: cursor.id } }],
    };
  }

  const price = new Prisma.Decimal(cursor.key);
  const afterCursorPrice = ascending
    ? { is: { price: { gt: price } } }
    : { is: { price: { lt: price } } };
  const onCursorPrice = ascending
    ? { AND: [{ shopeeItem: { is: { price } } }, { id: { gt: cursor.id } }] }
    : { AND: [{ shopeeItem: { is: { price } } }, { id: { lt: cursor.id } }] };

  return {
    OR: [{ shopeeItem: afterCursorPrice }, onCursorPrice, nullPriceFilter()],
  };
}

function cursorKeyFor(sort: CatalogSort, product: ProductWithRelations): string | null {
  switch (sort) {
    case 'price_asc':
    case 'price_desc':
      return product.shopeeItem?.price ? product.shopeeItem.price.toFixed(2) : null;
    case 'featured':
      return product.featuredRank === null ? null : String(product.featuredRank);
    case 'newest':
    default:
      return product.publishedAt?.toISOString() ?? null;
  }
}

function hashSignal(salt: string, value: string | undefined): string | null {
  if (!value) return null;
  return createHash('sha256').update(`${salt}:${value}`).digest('hex');
}

function toPlainObject(value: Prisma.JsonValue | null): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}
