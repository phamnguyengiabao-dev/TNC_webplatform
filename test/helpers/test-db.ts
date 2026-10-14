import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { Prisma, PrismaClient } from '@prisma/client';

import { money, splitCommission } from '../../src/common/money';
import { PrismaService } from '../../src/prisma/prisma.service';

/** The services under test, built by hand: no HTTP layer exists yet. */
export function createPrismaService(): PrismaService {
  // log: [] because several tests deliberately trigger unique-violation races;
  // their Prisma error logging is expected output, not a signal.
  return new PrismaService({ log: [] });
}

/**
 * BankingService only reads `app.commissionBps` from config. A stub keeps the
 * tests independent of ConfigModule internals while still proving the service
 * honours the configured rate.
 */
export function configWithCommissionBps(bps: number): ConfigService {
  const stub = {
    get: (key: string, defaultValue?: unknown) =>
      key === 'app.commissionBps' ? bps : defaultValue,
  };
  return stub as unknown as ConfigService;
}

/**
 * Wipes all business data and brings the system wallets back to zero.
 *
 * System wallets are NOT deleted: they are seeded by the migration and are
 * referenced by the `code` unique index. Ledger rows are truncated (tests are
 * allowed to destroy history; the append-only triggers only block UPDATE and
 * DELETE, and TRUNCATE is deliberately something only a test harness does).
 */
export async function resetDatabase(prisma: PrismaClient): Promise<void> {
  // TRUNCATE and DELETE are mixed deliberately:
  //   - LedgerEntry blocks DELETE and UPDATE through a trigger, so it can only
  //     be cleared with TRUNCATE.
  //   - "UserProfile" must NOT be truncated: the system wallets are referenced
  //     by code only, but TRUNCATE ... CASCADE follows every foreign key that
  //     references the truncated table, and Wallet.ownerId -> UserProfile is
  //     one of them. A CASCADE there wipes the four system wallets the whole
  //     ledger depends on (this bit us once).
  // Deleting in FK order keeps the system wallets intact, and their ids stay
  // stable so LedgerService's per-process cache never goes stale.
  await prisma.$executeRawUnsafe(
    `truncate table "LedgerEntry", "LedgerTransfer", "Order", "WithdrawalRequest",
       "PayoutMethod", "IdempotencyRecord", "AuditLog", "ShopeeShop", "SyncRun"
     restart identity cascade`,
  );
  await prisma.$executeRawUnsafe(`delete from "Wallet" where kind = 'USER'`);
  await prisma.$executeRawUnsafe(`delete from "UserProfile"`);
  await prisma.$executeRawUnsafe(`delete from auth.users`);
  await prisma.$executeRawUnsafe(`update "Wallet" set balance = 0, version = 0`);
}

/**
 * Clears everything that moves money (orders, transfers, entries, idempotency
 * records) and brings every wallet balance back to zero. Users stay untouched,
 * so a spec can keep the same principals across cases.
 */
export async function resetMoneyState(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe(
    `truncate table "LedgerEntry", "LedgerTransfer", "Order", "IdempotencyRecord"
     restart identity cascade`,
  );
  await prisma.$executeRawUnsafe(`update "Wallet" set balance = 0, version = 0`);
}

/**
 * Xoá dữ liệu catalog/sync Shopee (item, model, run, error) nhưng giữ user và
 * ví hệ thống. TRUNCATE cascade đi theo FK ShopeeShop -> ShopeeItem ->
 * ShopeeItemModel -> Product -> OutboundClick và SyncRun -> SyncError.
 * `Collection` sống sót vì nó được seed bằng migration, không phải bằng test.
 */
export async function resetShopeeState(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe(
    `truncate table "ShopeeShop", "SyncRun", "Product", "OutboundClick" restart identity cascade`,
  );
}

/**
 * Xoá phần curation (product + click) nhưng giữ nguyên item Shopee và
 * collection - dùng cho test cần dựng lại showroom trên cùng bộ dữ liệu sync.
 */
export async function resetCatalogState(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe(
    `truncate table "OutboundClick", "Product" restart identity cascade`,
  );
}

export async function collectionIdBySlug(prisma: PrismaClient, slug: string): Promise<string> {
  const collection = await prisma.collection.findUniqueOrThrow({
    where: { slug },
    select: { id: true },
  });
  return collection.id;
}

/**
 * Dựng thẳng một ShopeeItem như thể nó vừa được sync về. Nhanh hơn nhiều so
 * với upload file CSV, và cho phép test chủ động đặt `itemStatus`/`lastSeenAt`
 * để chạm đúng nhánh policy cần kiểm tra.
 */
export async function seedShopeeItem(
  prisma: PrismaClient,
  input: {
    shopeeShopId?: string;
    itemId: string;
    name: string;
    price?: string;
    stock?: number | null;
    status?: 'NORMAL' | 'UNLIST' | 'BANNED' | 'DELETED' | 'NOT_SEEN';
    imageUrls?: string[];
    lastSeenAt?: Date;
  },
): Promise<{ shopId: string; itemRefId: string }> {
  const shopeeShopId = BigInt(input.shopeeShopId ?? '38003654');
  const shop = await prisma.shopeeShop.upsert({
    where: { shopeeShopId },
    create: { shopeeShopId, name: `Shopee shop ${shopeeShopId}` },
    update: {},
    select: { id: true },
  });

  const lastSeenAt = input.lastSeenAt ?? new Date();
  const item = await prisma.shopeeItem.upsert({
    where: { shopId_itemId: { shopId: shop.id, itemId: BigInt(input.itemId) } },
    create: {
      shopId: shop.id,
      itemId: BigInt(input.itemId),
      itemName: input.name,
      itemStatus: input.status ?? 'NORMAL',
      price: input.price ?? null,
      stock: input.stock === undefined ? 1 : input.stock,
      imageUrls: input.imageUrls ?? [],
      contentHash: `seed-${input.itemId}`,
      lastSeenAt,
    },
    update: {
      itemName: input.name,
      itemStatus: input.status ?? 'NORMAL',
      price: input.price ?? null,
      stock: input.stock === undefined ? 1 : input.stock,
      imageUrls: input.imageUrls ?? [],
      lastSeenAt,
    },
    select: { id: true },
  });

  return { shopId: shop.id, itemRefId: item.id };
}

/**
 * Creates a user the same way Supabase Auth does: a row in auth.users. The
 * migration's trigger then provisions UserProfile and the VND wallet, which is
 * exactly the path that runs in production on signup.
 */
export async function seedUser(prisma: PrismaClient, email: string): Promise<string> {
  const id = randomUUID();
  await prisma.$executeRaw`insert into auth.users (id, email) values (${id}::uuid, ${email})`;
  return id;
}

export async function userWalletId(prisma: PrismaClient, userId: string): Promise<string> {
  const wallet = await prisma.wallet.findUniqueOrThrow({
    where: { ownerId_currency: { ownerId: userId, currency: 'VND' } },
    select: { id: true },
  });
  return wallet.id;
}

export async function userBalance(prisma: PrismaClient, userId: string): Promise<Prisma.Decimal> {
  const wallet = await prisma.wallet.findUniqueOrThrow({
    where: { ownerId_currency: { ownerId: userId, currency: 'VND' } },
    select: { balance: true },
  });
  return wallet.balance;
}

export async function systemBalance(prisma: PrismaClient, code: string): Promise<Prisma.Decimal> {
  const wallet = await prisma.wallet.findUniqueOrThrow({
    where: { code },
    select: { balance: true },
  });
  return wallet.balance;
}

/**
 * Creates an order exactly like checkout would: the commission is computed
 * once and frozen on the row.
 */
export async function seedOrder(
  prisma: PrismaClient,
  input: {
    buyerId: string;
    sellerId: string | null;
    gross: string;
    commissionBps?: number;
  },
): Promise<{ id: string }> {
  const gross = money(input.gross);
  const { commission } = splitCommission(gross, input.commissionBps ?? 500);
  const order = await prisma.order.create({
    data: {
      code: `ORD-${randomUUID()}`,
      buyerId: input.buyerId,
      sellerId: input.sellerId,
      grossAmount: gross,
      commissionAmount: commission,
    },
    select: { id: true },
  });
  return order;
}

export async function seedPaidWithdrawal(
  prisma: PrismaClient,
  input: { userId: string; amount: string },
): Promise<{ id: string }> {
  const payoutMethod = await prisma.payoutMethod.create({
    data: {
      ownerId: input.userId,
      bankCode: 'VCB',
      accountNumberMasked: '****1234',
      accountHolder: 'TEST USER',
      isVerified: true,
    },
    select: { id: true },
  });

  return prisma.withdrawalRequest.create({
    data: {
      userId: input.userId,
      payoutMethodId: payoutMethod.id,
      amount: money(input.amount),
    },
    select: { id: true },
  });
}
