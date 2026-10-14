import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, ShopeeItemStatus, SyncRunStatus } from '@prisma/client';
import { createHash } from 'node:crypto';

import { AppError } from '../../common/errors/app-error';
import { PrismaService } from '../../prisma/prisma.service';
import { CatalogAvailabilityService } from '../catalog/catalog-availability.service';
import type { CatalogField } from '../shopee/shopee.constants';
import {
  CsvShopeeProvider,
  ParsedRowError,
} from '../shopee/providers/csv/csv-shopee.provider';
import { AffiliateShopeeProvider } from '../shopee/providers/affiliate/affiliate-shopee.provider';
import type {
  ItemModelSnapshot,
  ItemSnapshot,
} from '../shopee/providers/shopee-sync-provider.interface';
import type { SyncRunQueryDto } from './dto/sync-run.dto';

/** Số item xử lý trong một transaction; chunk nhỏ giữ transaction ngắn. */
const CHUNK_SIZE = 100;

/** Run RUNNING quá lâu (process chết giữa chừng) bị coi là stale. */
const STALE_RUN_MS = 30 * 60 * 1000;

/** Số cảnh báo tối đa trả về response (DB vẫn lưu đủ). */
const MAX_WARNINGS = 50;

/** Chỉ các trạng thái này mới bị đánh NOT_SEEN - BANNED/DELETED là trạng thái cuối. */
const NOT_SEEN_ELIGIBLE: ShopeeItemStatus[] = ['NORMAL', 'UNLIST', 'NOT_SEEN'];

export interface SyncImportInput {
  file: Buffer;
  filename: string;
  actorId: string;
  shopeeShopId?: string;
  shopName?: string;
}

/** Số liệu một lần sync - lưu vào SyncRun.stats và trả về response. */
export interface SyncStats {
  receivedRows: number;
  itemsParsed: number;
  created: number;
  updated: number;
  unchanged: number;
  errors: number;
  notSeen: number;
  /** Sản phẩm showroom bị policy ẩn sau lần sync này. */
  productsHidden: number;
  /** Sản phẩm tự hiện lại vì item đã bán được trở lại. */
  productsRestored: number;
}

export interface SyncImportResult {
  runId: string;
  status: SyncRunStatus;
  shop: { id: string; shopeeShopId: string };
  stats: SyncStats;
  columns: Partial<Record<CatalogField, string>>;
  warnings: ParsedRowError[];
  warningCount: number;
}

/**
 * Sync engine cho catalog Shopee (S2 - docs/backend/SHOPEE_SHOWROOM_BACKEND.md).
 *
 * Nguyên tắc:
 *   - Shopee là nguồn sự thật của dữ liệu thương mại: giá, tồn, trạng thái,
 *     tên, ảnh, phân loại.
 *   - Không bao giờ xoá cứng: item biến mất khỏi nguồn chỉ bị đánh NOT_SEEN.
 *   - Mọi lần chạy đều có SyncRun + SyncError để truy vết.
 *   - Item không đổi (content_hash bằng nhau) chỉ được "chạm" lastSeenAt.
 */
@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly csv: CsvShopeeProvider,
    private readonly affiliate: AffiliateShopeeProvider,
    private readonly availability: CatalogAvailabilityService,
  ) {}

  async listRuns(query: SyncRunQueryDto): Promise<{ items: Record<string, unknown>[]; nextCursor: string | null }> {
    const take = query.take ?? 25;
    const rows = await this.prisma.syncRun.findMany({
      where: {
        ...(query.provider ? { provider: query.provider } : {}),
        ...(query.status ? { status: query.status } : {}),
      },
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
      take: take + 1,
      include: {
        shop: { select: { shopeeShopId: true, name: true } },
        _count: { select: { errors: true } },
      },
    });
    const hasMore = rows.length > take;
    const page = hasMore ? rows.slice(0, take) : rows;
    return {
      items: page.map((run) => ({
        id: run.id,
        provider: run.provider,
        mode: run.mode,
        status: run.status,
        stats: run.stats,
        startedAt: run.startedAt.toISOString(),
        finishedAt: run.finishedAt?.toISOString() ?? null,
        shop: run.shop ? { shopId: run.shop.shopeeShopId.toString(), name: run.shop.name } : null,
        errorCount: run._count.errors,
      })),
      nextCursor: hasMore ? page.at(-1)?.id ?? null : null,
    };
  }

  async getRun(id: string): Promise<Record<string, unknown>> {
    const run = await this.prisma.syncRun.findUnique({
      where: { id },
      include: {
        shop: { select: { shopeeShopId: true, name: true } },
        errors: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!run) throw AppError.notFound(`sync run ${id} not found`);
    return {
      id: run.id,
      provider: run.provider,
      mode: run.mode,
      status: run.status,
      stats: run.stats,
      startedAt: run.startedAt.toISOString(),
      finishedAt: run.finishedAt?.toISOString() ?? null,
      shop: run.shop ? { shopId: run.shop.shopeeShopId.toString(), name: run.shop.name } : null,
      errors: run.errors.map((error) => ({
        itemRef: error.itemRef,
        code: error.code,
        message: error.message,
        createdAt: error.createdAt.toISOString(),
      })),
    };
  }

  /** Import file export từ Shopee Seller Center (MANUAL_IMPORT). */
  async importCsv(input: SyncImportInput): Promise<SyncImportResult> {
    const provider = this.config.get<string>('shopee.provider', 'csv');
    if (provider !== 'csv') {
      throw new AppError('SHOPEE_NOT_CONNECTED', {
        logMessage: `SHOPEE_SYNC_PROVIDER=${provider} is not implemented yet (S2 ships 'csv' only)`,
        detail: `Provider đồng bộ "${provider}" chưa được hỗ trợ.`,
      });
    }

    // Parse trước khi tạo run: file hỏng/thiếu cột phải không để lại rác.
    const parsed = await this.csv.parse(input.file, input.filename);
    const shop = await this.resolveShop(input);

    await this.clearStaleRuns();
    await this.assertNoRunInFlight();

    const run = await this.prisma.syncRun.create({
      data: {
        shopId: shop.id,
        provider: 'CSV',
        mode: 'MANUAL_IMPORT',
        status: 'RUNNING',
        startedBy: input.actorId,
        storageRef: input.filename,
      },
      select: { id: true },
    });

    try {
      const stats = await this.applyCatalog({
        shopId: shop.id,
        runId: run.id,
        snapshots: parsed.items,
        seenItemIds: parsed.seenItemIds,
        rowErrors: parsed.errors,
        receivedRows: parsed.receivedRows,
      });
      // Policy hiển thị chạy sau khi dữ liệu thương mại đã ghi xong: item vừa
      // BANNED/DELETED phải biến khỏi showroom ngay trong cùng lần sync.
      const policy = await this.availability.applySyncPolicy(shop.id);
      stats.productsHidden = policy.hidden;
      stats.productsRestored = policy.restored;
      const status: SyncRunStatus = parsed.errors.length > 0 ? 'PARTIAL' : 'SUCCEEDED';
      await this.finishRun(run.id, status, stats);
      await this.prisma.shopeeShop.update({
        where: { id: shop.id },
        data: { lastSyncAt: new Date() },
      });

      return {
        runId: run.id,
        status,
        shop: { id: shop.id, shopeeShopId: shop.shopeeShopId.toString() },
        stats,
        columns: parsed.columns,
        warnings: parsed.errors.slice(0, MAX_WARNINGS),
        warningCount: parsed.errors.length,
      };
    } catch (error) {
      await this.failRun(run.id, error);
      if (error instanceof AppError) throw error;
      throw AppError.internal(`sync run ${run.id} failed: ${describe(error)}`, error);
    }
  }

  /** Refresh price/image/affiliate link from the affiliate offer feed. */
  async runAffiliate(
    actorId: string | null,
    mode: 'full' | 'incremental' = 'incremental',
  ): Promise<{ runId: string; status: SyncRunStatus; stats: SyncStats }> {
    const providerName = this.config.get<string>('shopee.provider', 'csv');
    if (providerName !== 'affiliate') {
      throw new AppError('SHOPEE_NOT_CONNECTED', {
        logMessage: `SHOPEE_SYNC_PROVIDER=${providerName}; affiliate sync requires provider=affiliate`,
        detail: 'Hãy chọn provider affiliate trước khi chạy đồng bộ.',
      });
    }
    const shop = await this.resolveShop({});
    await this.clearStaleRuns();
    await this.assertNoRunInFlight();
    const run = await this.prisma.syncRun.create({
      data: { shopId: shop.id, provider: 'AFFILIATE', mode: mode === 'full' ? 'FULL' : 'INCREMENTAL', status: 'RUNNING', startedBy: actorId },
      select: { id: true },
    });
    try {
      const snapshots: ItemSnapshot[] = [];
      let cursor: { value: string } | undefined;
      // Guard against a broken upstream cursor causing an unbounded job.
      for (let page = 0; page < 200; page += 1) {
        const result = await this.affiliate.fetchCatalog(cursor);
        snapshots.push(...result.items);
        cursor = result.nextCursor;
        if (!cursor) break;
        if (page === 199) throw new Error('affiliate pagination exceeded 200 pages');
      }

      const stats: SyncStats = {
        receivedRows: snapshots.length,
        itemsParsed: snapshots.length,
        created: 0,
        updated: 0,
        unchanged: 0,
        errors: 0,
        notSeen: 0,
        productsHidden: 0,
        productsRestored: 0,
      };
      for (let offset = 0; offset < snapshots.length; offset += CHUNK_SIZE) {
        const chunk = snapshots.slice(offset, offset + CHUNK_SIZE);
        await this.prisma.$transaction(async (tx) => {
          for (const snapshot of chunk) await this.applyAffiliateOne(tx, shop.id, snapshot, stats);
        }, { timeout: 60_000 });
      }
      const policy = await this.availability.applySyncPolicy(shop.id);
      stats.productsHidden = policy.hidden;
      stats.productsRestored = policy.restored;
      const status: SyncRunStatus = 'SUCCEEDED';
      await this.finishRun(run.id, status, stats);
      await this.prisma.shopeeShop.update({ where: { id: shop.id }, data: { lastSyncAt: new Date() } });
      return { runId: run.id, status, stats };
    } catch (error) {
      await this.failRun(run.id, error);
      if (error instanceof AppError) throw error;
      throw AppError.internal(`affiliate sync run ${run.id} failed: ${describe(error)}`, error);
    }
  }

  /**
   * Affiliate feeds are incomplete for stock/listing state. Preserve those
   * fields and never mark absent feed items NOT_SEEN.
   */
  private async applyAffiliateOne(
    tx: Prisma.TransactionClient,
    shopId: string,
    snapshot: ItemSnapshot,
    stats: SyncStats,
  ): Promise<void> {
    const itemId = BigInt(snapshot.shopeeItemId);
    const existing = await tx.shopeeItem.findUnique({
      where: { shopId_itemId: { shopId, itemId } },
      select: {
        id: true,
        itemStatus: true,
        stock: true,
        imageUrls: true,
        price: true,
        priceMin: true,
        priceMax: true,
        affiliateUrl: true,
      },
    });
    const next = {
      itemName: snapshot.name,
      ...(snapshot.price !== undefined ? { price: snapshot.price } : {}),
      ...(snapshot.priceMin !== undefined ? { priceMin: snapshot.priceMin } : {}),
      ...(snapshot.priceMax !== undefined ? { priceMax: snapshot.priceMax } : {}),
      ...(snapshot.imageUrls.length > 0 ? { imageUrls: snapshot.imageUrls as Prisma.InputJsonValue } : {}),
      ...(snapshot.affiliateUrl ? { affiliateUrl: snapshot.affiliateUrl } : {}),
    };
    if (!existing) {
      const initial: ItemSnapshot = { ...snapshot, status: 'NORMAL', stock: undefined };
      await tx.shopeeItem.create({
        data: {
          shopId,
          itemId,
          itemName: snapshot.name,
          itemStatus: 'NORMAL',
          price: snapshot.price ?? null,
          priceMin: snapshot.priceMin ?? null,
          priceMax: snapshot.priceMax ?? null,
          stock: null,
          affiliateUrl: snapshot.affiliateUrl ?? null,
          imageUrls: snapshot.imageUrls as Prisma.InputJsonValue,
          contentHash: hashSnapshot(initial),
          lastSeenAt: new Date(),
          raw: snapshot.raw as Prisma.InputJsonValue,
        },
      });
      stats.created += 1;
      return;
    }
    const changed =
      (snapshot.price !== undefined && existing.price?.toString() !== snapshot.price) ||
      (snapshot.priceMin !== undefined && existing.priceMin?.toString() !== snapshot.priceMin) ||
      (snapshot.priceMax !== undefined && existing.priceMax?.toString() !== snapshot.priceMax) ||
      (snapshot.imageUrls.length > 0 && JSON.stringify(existing.imageUrls) !== JSON.stringify(snapshot.imageUrls)) ||
      (snapshot.affiliateUrl !== undefined && snapshot.affiliateUrl !== existing.affiliateUrl);
    if (!changed) {
      await tx.shopeeItem.update({ where: { id: existing.id }, data: { lastSeenAt: new Date() } });
      stats.unchanged += 1;
      return;
    }
    await tx.shopeeItem.update({
      where: { id: existing.id },
      data: {
        ...next,
        lastSeenAt: new Date(),
        raw: snapshot.raw as Prisma.InputJsonValue,
      },
    });
    stats.updated += 1;
  }

  private async applyCatalog(input: {
    shopId: string;
    runId: string;
    snapshots: ItemSnapshot[];
    seenItemIds: string[];
    rowErrors: ParsedRowError[];
    receivedRows: number;
  }): Promise<SyncStats> {
    const stats: SyncStats = {
      receivedRows: input.receivedRows,
      itemsParsed: input.snapshots.length,
      created: 0,
      updated: 0,
      unchanged: 0,
      errors: input.rowErrors.length,
      notSeen: 0,
      productsHidden: 0,
      productsRestored: 0,
    };

    if (input.rowErrors.length > 0) {
      await this.prisma.syncError.createMany({
        data: input.rowErrors.map((error) => ({
          runId: input.runId,
          itemRef: String(error.row),
          code: error.code,
          message: error.message,
        })),
      });
    }

    for (let offset = 0; offset < input.snapshots.length; offset += CHUNK_SIZE) {
      const chunk = input.snapshots.slice(offset, offset + CHUNK_SIZE);
      await this.prisma.$transaction(
        async (tx) => {
          for (const snapshot of chunk) {
            await this.applyOne(tx, input.shopId, snapshot, stats);
          }
        },
        { timeout: 60_000 },
      );
    }

    // Item không còn trong file nguồn: đánh dấu, KHÔNG xoá. Chỉ áp dụng khi
    // file có ít nhất một dòng hợp lệ (nếu không, provider đã ném lỗi trước đó).
    if (input.seenItemIds.length > 0) {
      const seen = input.seenItemIds.map((id) => BigInt(id));
      const marked = await this.prisma.shopeeItem.updateMany({
        where: {
          shopId: input.shopId,
          itemStatus: { in: NOT_SEEN_ELIGIBLE },
          itemId: { notIn: seen },
        },
        data: { itemStatus: 'NOT_SEEN' },
      });
      stats.notSeen = marked.count;
    }

    return stats;
  }

  private async applyOne(
    tx: Prisma.TransactionClient,
    shopId: string,
    snapshot: ItemSnapshot,
    stats: SyncStats,
  ): Promise<void> {
    const itemId = BigInt(snapshot.shopeeItemId);
    const contentHash = hashSnapshot(snapshot);
    const now = new Date();
    const existing = await tx.shopeeItem.findUnique({
      where: { shopId_itemId: { shopId, itemId } },
      select: { id: true, contentHash: true, itemStatus: true },
    });

    const commerce = {
      itemName: snapshot.name,
      itemStatus: snapshot.status,
      price: snapshot.price ?? null,
      priceMin: snapshot.priceMin ?? null,
      priceMax: snapshot.priceMax ?? null,
      stock: snapshot.stock ?? null,
      hasModel: (snapshot.models?.length ?? 0) > 0,
      imageUrls: snapshot.imageUrls as Prisma.InputJsonValue,
      description: snapshot.description ?? null,
      shopeeUpdateTime: snapshot.shopeeUpdateTime ?? null,
      contentHash,
      lastSeenAt: now,
      raw: snapshot.raw as Prisma.InputJsonValue,
    };

    if (!existing) {
      await tx.shopeeItem.create({
        data: {
          shopId,
          itemId,
          ...commerce,
          firstSeenAt: now,
          models: { create: modelCreates(snapshot.models) },
        },
      });
      stats.created += 1;
      return;
    }

    // NOT_SEEN -> NORMAL cũng là một thay đổi: lastSeenAt đã chứng minh item
    // còn bán, nên trạng thái phải quay lại giá trị nguồn.
    const changed = existing.contentHash !== contentHash || existing.itemStatus !== snapshot.status;
    if (!changed) {
      await tx.shopeeItem.update({
        where: { id: existing.id },
        data: { lastSeenAt: now, raw: snapshot.raw as Prisma.InputJsonValue },
      });
      stats.unchanged += 1;
      return;
    }

    await tx.shopeeItem.update({
      where: { id: existing.id },
      data: {
        ...commerce,
        models: { deleteMany: {}, create: modelCreates(snapshot.models) },
      },
    });
    stats.updated += 1;
  }

  private async resolveShop(
    input: Pick<SyncImportInput, 'shopeeShopId' | 'shopName'>,
  ): Promise<{ id: string; shopeeShopId: bigint }> {
    const configured = this.config.get<string>('shopee.shopId', '').trim();
    const rawId = (input.shopeeShopId ?? configured).trim();
    if (!rawId) {
      throw new AppError('SHOPEE_NOT_CONNECTED', {
        logMessage: 'no shopeeShopId form field and SHOPEE_SHOP_ID is not configured',
        detail:
          'Chưa cấu hình gian hàng Shopee: gửi kèm field shopeeShopId hoặc đặt biến môi trường SHOPEE_SHOP_ID.',
      });
    }
    if (!/^\d{1,19}$/.test(rawId)) {
      throw AppError.validation(
        `SHOPEE_SHOP_ID must be digits, got "${rawId}"`,
        'shopeeShopId phải là chữ số.',
      );
    }

    const shopeeShopId = BigInt(rawId);
    const configuredName = this.config.get<string>('shopee.shopName', '').trim();
    const name = input.shopName?.trim() || configuredName || `Shopee shop ${rawId}`;
    const region = this.config.get<string>('shopee.region', 'vn');
    return this.prisma.shopeeShop.upsert({
      where: { shopeeShopId },
      create: { shopeeShopId, name, region },
      update: { name },
      select: { id: true, shopeeShopId: true },
    });
  }

  private async clearStaleRuns(): Promise<void> {
    const cutoff = new Date(Date.now() - STALE_RUN_MS);
    const stale = await this.prisma.syncRun.updateMany({
      where: { status: 'RUNNING', startedAt: { lt: cutoff } },
      data: { status: 'FAILED', finishedAt: new Date() },
    });
    if (stale.count > 0) {
      this.logger.warn(`marked ${stale.count} stale RUNNING sync run(s) as FAILED`);
    }
  }

  private async assertNoRunInFlight(): Promise<void> {
    const running = await this.prisma.syncRun.findFirst({
      where: { status: 'RUNNING' },
      select: { id: true, startedAt: true },
    });
    if (running) {
      throw new AppError('SYNC_ALREADY_RUNNING', {
        logMessage: `sync run ${running.id} (started ${running.startedAt.toISOString()}) is still RUNNING`,
      });
    }
  }

  private async finishRun(runId: string, status: SyncRunStatus, stats: SyncStats): Promise<void> {
    await this.prisma.syncRun.update({
      where: { id: runId },
      data: {
        status,
        finishedAt: new Date(),
        stats: stats as unknown as Prisma.InputJsonValue,
      },
    });
  }

  private async failRun(runId: string, error: unknown): Promise<void> {
    try {
      await this.prisma.syncRun.update({
        where: { id: runId },
        data: { status: 'FAILED', finishedAt: new Date() },
      });
      await this.prisma.syncError.create({
        data: { runId, code: 'RUN_FAILED', message: describe(error) },
      });
    } catch (updateError) {
      this.logger.error(`could not mark sync run ${runId} as FAILED: ${describe(updateError)}`);
    }
  }
}

function modelCreates(
  models: ItemModelSnapshot[] | undefined,
): Array<{ modelId: string; name: string; price: string | null; stock: number | null }> {
  return (models ?? []).map((model) => ({
    modelId: model.modelId,
    name: model.name,
    price: model.price ?? null,
    stock: model.stock ?? null,
  }));
}

/**
 * sha256 của các trường thương mại (tên + giá + tồn + trạng thái + ảnh + phân
 * loại). Hash đổi nghĩa là có cập nhật thật cần ghi; hash bằng nghĩa là chỉ
 * cần chạm lastSeenAt. `raw` cố tình không nằm trong hash.
 */
function hashSnapshot(snapshot: ItemSnapshot): string {
  const payload = {
    name: snapshot.name,
    status: snapshot.status,
    price: snapshot.price ?? null,
    priceMin: snapshot.priceMin ?? null,
    priceMax: snapshot.priceMax ?? null,
    stock: snapshot.stock ?? null,
    description: snapshot.description ?? null,
    imageUrls: snapshot.imageUrls,
    models: [...(snapshot.models ?? [])]
      .sort((left, right) => (left.modelId < right.modelId ? -1 : left.modelId > right.modelId ? 1 : 0))
      .map((model) => ({
        modelId: model.modelId,
        name: model.name,
        price: model.price ?? null,
        stock: model.stock ?? null,
      })),
  };
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
