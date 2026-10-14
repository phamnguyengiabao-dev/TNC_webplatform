import { Injectable, Logger } from '@nestjs/common';
import { Prisma, ProductVisibility, ShopeeItemStatus } from '@prisma/client';

import { AppError } from '../../common/errors/app-error';
import { toJson } from '../../common/money';
import { slugify, uniqueSlug } from '../../common/slug';
import { PrismaService } from '../../prisma/prisma.service';
import { hideReasonFor } from '../catalog/catalog.policy';
import { CatalogService } from '../catalog/catalog.service';
import { PRODUCT_INCLUDE, productTitle, type ProductWithRelations } from '../catalog/catalog.view';
import { CreateProductDto, UpdateProductDto } from './dto/product-write.dto';
import { AdminProductQueryDto, StagingQueryDto } from './dto/staging-query.dto';

/** Trần kích thước khối QA - copy tự do nhưng không phải chỗ chứa file. */
const MAX_QA_BYTES = 4096;
const DEFAULT_TAKE = 24;

export interface StagingItemView {
  id: string;
  itemId: string;
  itemName: string;
  itemStatus: ShopeeItemStatus;
  price: string | null;
  stock: number | null;
  image: string | null;
  shopeeUpdateTime: string | null;
  lastSeenAt: string;
  product: {
    id: string;
    slug: string;
    title: string;
    visibility: ProductVisibility;
    collection: string;
  } | null;
}

export interface AdminProductView {
  id: string;
  slug: string;
  title: string;
  visibility: ProductVisibility;
  collection: string;
  collectionTitle: string;
  conditionPercent: number | null;
  sealStatus: string | null;
  badges: string[];
  featuredRank: number | null;
  buyUrlOverride: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  shopee: { itemId: string; shopId: string; status: ShopeeItemStatus; itemName: string } | null;
  /** Vì sao sản phẩm đang không hiển thị được (null = đang hiển thị tốt). */
  hiddenReason: string | null;
}

export interface StagingPage {
  items: StagingItemView[];
  nextCursor: string | null;
}

export interface AdminProductPage {
  items: AdminProductView[];
  nextCursor: string | null;
}

/**
 * Curation: chọn item Shopee lên showroom, viết copy, đặt tình trạng và
 * publish/unpublish (docs/backend/SHOPEE_SHOWROOM_BACKEND.md 4.3).
 *
 * Không bao giờ sửa dữ liệu thương mại (giá, tồn, trạng thái bán) - đó là
 * việc của sync.
 */
@Injectable()
export class CurationService {
  private readonly logger = new Logger(CurationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: CatalogService,
  ) {}

  async listStagingItems(query: StagingQueryDto): Promise<StagingPage> {
    const take = query.take ?? DEFAULT_TAKE;
    const filters: Prisma.ShopeeItemWhereInput[] = [];
    if (query.status) filters.push({ itemStatus: query.status as ShopeeItemStatus });
    if (query.q?.trim()) {
      filters.push({ itemName: { contains: query.q.trim(), mode: 'insensitive' } });
    }
    if (query.linked === 'true') filters.push({ product: { isNot: null } });
    if (query.linked === 'false') filters.push({ product: { is: null } });
    if (query.cursor) filters.push(stagingCursorWhere(query.cursor));

    const rows = await this.prisma.shopeeItem.findMany({
      where: filters.length > 0 ? { AND: filters } : {},
      orderBy: [{ lastSeenAt: 'desc' }, { id: 'desc' }],
      take: take + 1,
      include: {
        product: { select: { id: true, slug: true, displayTitle: true, visibility: true, collection: { select: { slug: true } } } },
      },
    });

    const hasMore = rows.length > take;
    const page = hasMore ? rows.slice(0, take) : rows;
    const last = page.at(-1);

    return {
      items: page.map((item) => ({
        id: item.id,
        itemId: item.itemId.toString(),
        itemName: item.itemName,
        itemStatus: item.itemStatus,
        price: item.price ? toJson(item.price) : null,
        stock: item.stock,
        image: toStringList(item.imageUrls)[0] ?? null,
        shopeeUpdateTime: item.shopeeUpdateTime?.toISOString() ?? null,
        lastSeenAt: item.lastSeenAt.toISOString(),
        product: item.product
          ? {
              id: item.product.id,
              slug: item.product.slug,
              title: item.product.displayTitle?.trim() || item.itemName,
              visibility: item.product.visibility,
              collection: item.product.collection.slug,
            }
          : null,
      })),
      nextCursor: hasMore && last ? encodeStagingCursor(last.lastSeenAt, last.id) : null,
    };
  }

  async listProducts(query: AdminProductQueryDto): Promise<AdminProductPage> {
    const take = query.take ?? DEFAULT_TAKE;
    const filters: Prisma.ProductWhereInput[] = [];
    if (query.visibility) filters.push({ visibility: query.visibility as ProductVisibility });
    if (query.collection) filters.push({ collection: { slug: query.collection } });
    if (query.q?.trim()) {
      const q = query.q.trim();
      filters.push({
        OR: [
          { displayTitle: { contains: q, mode: 'insensitive' } },
          { slug: { contains: q, mode: 'insensitive' } },
          { shopeeItem: { is: { itemName: { contains: q, mode: 'insensitive' } } } },
        ],
      });
    }
    if (query.cursor) filters.push({ id: { lt: query.cursor } });

    const rows = await this.prisma.product.findMany({
      where: filters.length > 0 ? { AND: filters } : {},
      include: PRODUCT_INCLUDE,
      orderBy: { id: 'desc' },
      take: take + 1,
    });

    const hasMore = rows.length > take;
    const page = hasMore ? rows.slice(0, take) : rows;
    return {
      items: page.map((row) => this.toAdminView(row)),
      nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null,
    };
  }

  async createProduct(dto: CreateProductDto, actorId: string): Promise<AdminProductView> {
    const collection = await this.prisma.collection.findUnique({ where: { slug: dto.collectionSlug } });
    if (!collection) {
      throw AppError.notFound(`no collection with slug "${dto.collectionSlug}"`);
    }

    let item: { id: string; itemName: string } | null = null;
    if (dto.shopeeItemId) {
      const found = await this.prisma.shopeeItem.findUnique({
        where: { id: dto.shopeeItemId },
        select: { id: true, itemName: true, product: { select: { id: true } } },
      });
      if (!found) throw AppError.notFound(`no Shopee item with id "${dto.shopeeItemId}"`);
      if (found.product) {
        throw new AppError('ITEM_ALREADY_LINKED', {
          logMessage: `Shopee item ${found.id} already has product ${found.product.id}`,
          detail: 'Mặt hàng này đã có sản phẩm trên showroom.',
        });
      }
      item = { id: found.id, itemName: found.itemName };
    }

    assertQaSize(dto.qaNotes);
    const slug = await this.resolveSlug(dto.slug, dto.displayTitle ?? item?.itemName ?? 'san-pham', null);

    const data: Prisma.ProductCreateInput = {
      slug,
      collection: { connect: { id: collection.id } },
      displayTitle: dto.displayTitle?.trim() ?? null,
      blurb: dto.blurb?.trim() ?? null,
      conditionPercent: dto.conditionPercent ?? null,
      sealStatus: dto.sealStatus ?? null,
      badges: (dto.badges ?? []) as Prisma.InputJsonValue,
      buyUrlOverride: dto.buyUrlOverride?.trim() ?? null,
      featuredRank: dto.featuredRank ?? null,
    };
    if (item) data.shopeeItem = { connect: { id: item.id } };
    if (dto.qaNotes) data.qaNotes = dto.qaNotes as Prisma.InputJsonValue;

    const created = await this.prisma.product.create({ data, include: PRODUCT_INCLUDE });

    await this.audit(actorId, created.id, 'CREATE', null, created.visibility);
    return this.toAdminView(created);
  }

  async updateProduct(id: string, dto: UpdateProductDto, actorId: string): Promise<AdminProductView> {
    const product = await this.findOr404(id);
    assertQaSize(dto.qaNotes ?? undefined);

    const data: Prisma.ProductUpdateInput = {};
    if (dto.collectionSlug !== undefined) {
      const collection = await this.prisma.collection.findUnique({ where: { slug: dto.collectionSlug } });
      if (!collection) throw AppError.notFound(`no collection with slug "${dto.collectionSlug}"`);
      data.collection = { connect: { id: collection.id } };
    }
    if (dto.slug !== undefined) {
      data.slug = await this.resolveSlug(dto.slug, productTitle(product), product.id);
    }
    if (dto.shopeeItemId !== undefined) {
      const item = await this.prisma.shopeeItem.findUnique({
        where: { id: dto.shopeeItemId },
        select: { id: true, product: { select: { id: true } } },
      });
      if (!item) throw AppError.notFound(`no Shopee item with id "${dto.shopeeItemId}"`);
      if (item.product && item.product.id !== product.id) {
        throw new AppError('ITEM_ALREADY_LINKED', {
          logMessage: `Shopee item ${item.id} already has product ${item.product.id}`,
          detail: 'Mặt hàng này đã thuộc một sản phẩm khác trên showroom.',
        });
      }
      data.shopeeItem = { connect: { id: item.id } };
    }

    if (dto.displayTitle !== undefined) data.displayTitle = dto.displayTitle?.trim() ?? null;
    if (dto.blurb !== undefined) data.blurb = dto.blurb?.trim() ?? null;
    if (dto.conditionPercent !== undefined) data.conditionPercent = dto.conditionPercent;
    if (dto.sealStatus !== undefined) data.sealStatus = dto.sealStatus;
    if (dto.badges !== undefined) data.badges = dto.badges as Prisma.InputJsonValue;
    if (dto.qaNotes !== undefined) {
      data.qaNotes = dto.qaNotes === null ? Prisma.DbNull : (dto.qaNotes as Prisma.InputJsonValue);
    }
    if (dto.buyUrlOverride !== undefined) data.buyUrlOverride = dto.buyUrlOverride?.trim() ?? null;
    if (dto.featuredRank !== undefined) data.featuredRank = dto.featuredRank;

    if (Object.keys(data).length === 0) {
      throw AppError.validation('PATCH /admin/products with no updatable field');
    }

    const updated = await this.prisma.product.update({ where: { id }, data, include: PRODUCT_INCLUDE });
    await this.audit(actorId, id, 'UPDATE', product.visibility, updated.visibility);
    return this.toAdminView(updated);
  }

  async publish(id: string, actorId: string): Promise<AdminProductView> {
    const product = await this.findOr404(id);
    if (product.visibility === 'PUBLISHED') {
      return this.toAdminView(product);
    }

    const reason = hideReasonFor(product.shopeeItem, new Date(), this.catalog.hideAfterDays);
    if (reason) {
      throw new AppError('PRODUCT_UNLISTED', {
        logMessage: `cannot publish product ${id}: item is ${reason}`,
        detail: 'Mặt hàng đã ngừng bán trên Shopee nên không thể đăng lên showroom.',
      });
    }
    if (!product.shopeeItemId && !product.buyUrlOverride) {
      throw new AppError('ITEM_NOT_LINKED', {
        logMessage: `cannot publish product ${id}: no Shopee item and no buyUrlOverride`,
        detail: 'Cần gắn mặt hàng Shopee hoặc nhập link mua trước khi đăng bán.',
      });
    }

    const updated = await this.prisma.product.update({
      where: { id },
      data: { visibility: 'PUBLISHED', publishedAt: new Date() },
      include: PRODUCT_INCLUDE,
    });
    await this.audit(actorId, id, 'PUBLISH', product.visibility, 'PUBLISHED');
    return this.toAdminView(updated);
  }

  async unpublish(id: string, actorId: string): Promise<AdminProductView> {
    const product = await this.findOr404(id);
    if (product.visibility === 'DRAFT') {
      return this.toAdminView(product);
    }

    const updated = await this.prisma.product.update({
      where: { id },
      data: { visibility: 'DRAFT' },
      include: PRODUCT_INCLUDE,
    });
    await this.audit(actorId, id, 'UNPUBLISH', product.visibility, 'DRAFT');
    return this.toAdminView(updated);
  }

  private async findOr404(id: string): Promise<ProductWithRelations> {
    const product = await this.prisma.product.findUnique({ where: { id }, include: PRODUCT_INCLUDE });
    if (!product) throw AppError.notFound(`no product with id "${id}"`);
    return product;
  }

  private async resolveSlug(
    requested: string | undefined | null,
    fallbackBase: string,
    ignoreProductId: string | null,
  ): Promise<string> {
    const isTaken = async (candidate: string): Promise<boolean> => {
      const existing = await this.prisma.product.findUnique({
        where: { slug: candidate },
        select: { id: true },
      });
      return existing !== null && existing.id !== ignoreProductId;
    };

    if (requested && requested.trim().length > 0) {
      const candidate = slugify(requested);
      if (await isTaken(candidate)) {
        throw new AppError('SLUG_TAKEN', {
          logMessage: `slug "${candidate}" is already used by another product`,
          detail: 'Đường dẫn (slug) này đã được dùng, vui lòng chọn slug khác.',
        });
      }
      return candidate;
    }
    return uniqueSlug(fallbackBase, isTaken);
  }

  private toAdminView(product: ProductWithRelations): AdminProductView {
    const reason = hideReasonFor(product.shopeeItem, new Date(), this.catalog.hideAfterDays);
    return {
      id: product.id,
      slug: product.slug,
      title: productTitle(product),
      visibility: product.visibility,
      collection: product.collection.slug,
      collectionTitle: product.collection.title,
      conditionPercent: product.conditionPercent,
      sealStatus: product.sealStatus,
      badges: toStringList(product.badges),
      featuredRank: product.featuredRank,
      buyUrlOverride: product.buyUrlOverride,
      publishedAt: product.publishedAt?.toISOString() ?? null,
      createdAt: product.createdAt.toISOString(),
      updatedAt: product.updatedAt.toISOString(),
      shopee: product.shopeeItem
        ? {
            itemId: product.shopeeItem.itemId.toString(),
            shopId: product.shopeeItem.shop.shopeeShopId.toString(),
            status: product.shopeeItem.itemStatus,
            itemName: product.shopeeItem.itemName,
          }
        : null,
      hiddenReason: product.visibility === 'HIDDEN_BY_SYNC' ? (reason ?? 'HIDDEN_BY_SYNC') : reason,
    };
  }

  private async audit(
    actorId: string,
    productId: string,
    action: string,
    oldStatus: string | null,
    newStatus: string | null,
  ): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          entityType: 'Product',
          entityId: productId,
          action,
          oldStatus,
          newStatus,
          actorId,
          actorRole: 'STAFF',
        },
      });
    } catch (error) {
      // Audit không được phép chặn thao tác đã thành công.
      this.logger.warn(
        `could not write audit log for product ${productId} (${action}): ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

function assertQaSize(qa: Record<string, unknown> | undefined): void {
  if (!qa) return;
  if (Buffer.byteLength(JSON.stringify(qa), 'utf8') > MAX_QA_BYTES) {
    throw AppError.validation(
      `qaNotes payload exceeds ${MAX_QA_BYTES} bytes`,
      'Khối thông tin kiểm định quá dài (tối đa 4KB).',
    );
  }
}

function toStringList(value: Prisma.JsonValue): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string');
}

function encodeStagingCursor(lastSeenAt: Date, id: string): string {
  return Buffer.from(JSON.stringify({ v: 1, t: lastSeenAt.toISOString(), i: id }), 'utf8').toString(
    'base64url',
  );
}

function stagingCursorWhere(raw: string): Prisma.ShopeeItemWhereInput {
  let parsed: { v?: unknown; t?: unknown; i?: unknown };
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as typeof parsed;
  } catch {
    throw AppError.validation('staging cursor is not valid base64url JSON');
  }
  if (parsed.v !== 1 || typeof parsed.t !== 'string' || typeof parsed.i !== 'string') {
    throw AppError.validation('staging cursor payload is malformed');
  }
  const at = new Date(parsed.t);
  if (Number.isNaN(at.getTime())) throw AppError.validation('staging cursor has an invalid timestamp');

  return {
    OR: [{ lastSeenAt: { lt: at } }, { lastSeenAt: at, id: { lt: parsed.i } }],
  };
}
