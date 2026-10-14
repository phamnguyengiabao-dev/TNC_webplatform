import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';

import { money } from '../src/common/money';
import { BankingService } from '../src/modules/banking/banking.service';
import {
  AlreadyReversedError,
  DuplicateLegError,
  InsufficientFundsError,
  UnbalancedTransferError,
  WalletNotFoundError,
} from '../src/modules/banking/ledger.errors';
import { LedgerService } from '../src/modules/banking/ledger.service';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  configWithCommissionBps,
  createPrismaService,
  resetDatabase,
  seedUser,
  systemBalance,
  userBalance,
  userWalletId,
} from './helpers/test-db';

/**
 * These tests attack the ledger with raw SQL, deliberately bypassing
 * LedgerService, because the whole point of prisma/sql/finance_guards.sql is
 * that application bugs cannot move money. If someone drops a trigger during a
 * refactor, this suite goes red even though the services still look correct.
 */
describe('money invariants enforced by PostgreSQL (finance_guards.sql)', () => {
  let prisma: PrismaService;
  let ledger: LedgerService;
  let banking: BankingService;
  let buyerId: string;
  let buyerWalletId: string;
  let escrowId: string;
  let gatewayId: string;

  const fund = (amount: string) =>
    banking.confirmDeposit({
      userId: buyerId,
      amount: money(amount),
      gatewayRef: `seed-${randomUUID()}`,
    });

  async function insertRawTransfer(tx: Prisma.TransactionClient, id: string): Promise<void> {
    await tx.$executeRaw`
      insert into "LedgerTransfer" (id, kind, status, "idempotencyKey")
      values (${id}::uuid, 'ADJUSTMENT'::"TransferKind", 'POSTED'::"TransferStatus", ${`raw:${id}`})
    `;
  }

  async function insertRawEntry(
    tx: Prisma.TransactionClient,
    transferId: string,
    walletId: string,
    amount: string,
  ): Promise<void> {
    await tx.$executeRaw`
      insert into "LedgerEntry" (id, "transferId", "walletId", amount, "balanceAfter")
      values (gen_random_uuid(), ${transferId}::uuid, ${walletId}::uuid, ${amount}::numeric, 0)
    `;
  }

  beforeAll(async () => {
    prisma = createPrismaService();
    await prisma.$connect();
    ledger = new LedgerService(prisma);
    banking = new BankingService(prisma, ledger, configWithCommissionBps(500));
    escrowId = await ledger.systemWalletId('ESCROW');
    gatewayId = await ledger.systemWalletId('GATEWAY_CLEARING');
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    buyerId = await seedUser(prisma, 'buyer@test.local');
    buyerWalletId = await userWalletId(prisma, buyerId);
  });

  describe('database-level guards', () => {
    it('refuses to commit a transfer whose legs do not sum to zero', async () => {
      const transferId = randomUUID();
      await expect(
        prisma.$transaction(async (tx) => {
          await insertRawTransfer(tx, transferId);
          await insertRawEntry(tx, transferId, escrowId, '-100000');
          await insertRawEntry(tx, transferId, buyerWalletId, '50000'); // 5,000 commission forgotten
        }),
      ).rejects.toThrow();

      expect(await prisma.ledgerTransfer.count()).toBe(0);
      expect(await prisma.ledgerEntry.count()).toBe(0);
    });

    it('refuses a transfer with a single leg', async () => {
      const transferId = randomUUID();
      await expect(
        prisma.$transaction(async (tx) => {
          await insertRawTransfer(tx, transferId);
          await insertRawEntry(tx, transferId, buyerWalletId, '100000');
        }),
      ).rejects.toThrow();

      expect(await prisma.ledgerEntry.count()).toBe(0);
    });

    it('rejects fractional đồng at insert time', async () => {
      const transferId = randomUUID();
      await expect(
        prisma.$transaction(async (tx) => {
          await insertRawTransfer(tx, transferId);
          await insertRawEntry(tx, transferId, escrowId, '-100000.50');
          await insertRawEntry(tx, transferId, buyerWalletId, '100000.50');
        }),
      ).rejects.toThrow();

      expect(await prisma.ledgerEntry.count()).toBe(0);
    });

    it('rejects zero-amount legs', async () => {
      const transferId = randomUUID();
      await expect(
        prisma.$transaction(async (tx) => {
          await insertRawTransfer(tx, transferId);
          await insertRawEntry(tx, transferId, escrowId, '0');
          await insertRawEntry(tx, transferId, buyerWalletId, '0');
        }),
      ).rejects.toThrow();

      expect(await prisma.ledgerEntry.count()).toBe(0);
    });

    it('makes ledger entries append-only: UPDATE and DELETE are both refused', async () => {
      await fund('100000');
      const entry = await prisma.ledgerEntry.findFirstOrThrow();

      await expect(
        prisma.$executeRaw`update "LedgerEntry" set amount = 1 where id = ${entry.id}::uuid`,
      ).rejects.toThrow(/immutable/i);

      await expect(
        prisma.$executeRaw`delete from "LedgerEntry" where id = ${entry.id}::uuid`,
      ).rejects.toThrow(/immutable/i);

      const untouched = await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: entry.id } });
      expect(untouched.amount.equals(entry.amount)).toBe(true);
    });

    it('lets a transfer change only its status', async () => {
      await fund('100000');
      const transfer = await prisma.ledgerTransfer.findFirstOrThrow();

      await expect(
        prisma.$executeRaw`
          update "LedgerTransfer" set "idempotencyKey" = 'rewritten'
           where id = ${transfer.id}::uuid
        `,
      ).rejects.toThrow(/only LedgerTransfer.status/i);

      await prisma.$executeRaw`
        update "LedgerTransfer" set status = 'REVERSED'::"TransferStatus"
         where id = ${transfer.id}::uuid
      `;
      const updated = await prisma.ledgerTransfer.findUniqueOrThrow({ where: { id: transfer.id } });
      expect(updated.status).toBe('REVERSED');
    });

    it('never lets a user wallet go negative, even through raw SQL', async () => {
      await fund('100000');
      await expect(
        prisma.$executeRaw`update "Wallet" set balance = -1 where id = ${buyerWalletId}::uuid`,
      ).rejects.toThrow();

      expect((await userBalance(prisma, buyerId)).toFixed(0)).toBe('100000');
    });

    it('never lets escrow go negative', async () => {
      await expect(
        prisma.$executeRaw`update "Wallet" set balance = -1 where code = 'ESCROW'`,
      ).rejects.toThrow();
    });

    it('rejects two legs for the same wallet in one transfer', async () => {
      const transferId = randomUUID();
      await expect(
        prisma.$transaction(async (tx) => {
          await insertRawTransfer(tx, transferId);
          await insertRawEntry(tx, transferId, escrowId, '-100000');
          await insertRawEntry(tx, transferId, escrowId, '60000');
          await insertRawEntry(tx, transferId, buyerWalletId, '40000');
        }),
      ).rejects.toThrow();

      expect(await prisma.ledgerEntry.count()).toBe(0);
    });

    it('allows only one VND wallet per user', async () => {
      await expect(
        prisma.$executeRaw`
          insert into "Wallet" (id, kind, "ownerId", currency)
          values (gen_random_uuid(), 'USER'::"WalletKind", ${buyerId}::uuid, 'VND')
        `,
      ).rejects.toThrow();
    });

    it('keeps the finance tables out of reach of the Supabase anon/authenticated roles', async () => {
      const rls = await prisma.$queryRaw<Array<{ relname: string; rls: boolean }>>`
        select relname, relrowsecurity as rls
          from pg_class
         where relnamespace = 'public'::regnamespace
           and relkind = 'r'
           and relname in ('Wallet', 'LedgerTransfer', 'LedgerEntry', 'Order',
                           'PayoutMethod', 'WithdrawalRequest', 'IdempotencyRecord',
                           'AuditLog', 'UserProfile')
      `;
      expect(rls).toHaveLength(9);
      for (const table of rls) {
        expect({ table: table.relname, rls: table.rls }).toEqual({ table: table.relname, rls: true });
      }

      const privileges = await prisma.$queryRaw<
        Array<{ anon_read: boolean; authenticated_insert: boolean; anon_wallet_update: boolean }>
      >`
        select
          has_table_privilege('anon', 'public."Wallet"', 'select')            as anon_read,
          has_table_privilege('authenticated', 'public."LedgerEntry"', 'insert') as authenticated_insert,
          has_table_privilege('anon', 'public."Wallet"', 'update')            as anon_wallet_update
      `;
      expect(privileges[0]).toEqual({
        anon_read: false,
        authenticated_insert: false,
        anon_wallet_update: false,
      });
    });
  });

  describe('LedgerService pre-flight validation (before anything is written)', () => {
    it('refuses two legs for the same wallet', async () => {
      await expect(
        prisma.$transaction((tx) =>
          ledger.post(tx, {
            kind: 'ADJUSTMENT',
            idempotencyKey: `dup-${randomUUID()}`,
            legs: [
              { walletId: buyerWalletId, amount: money('-10000') },
              { walletId: buyerWalletId, amount: money('10000') },
            ],
          }),
        ),
      ).rejects.toBeInstanceOf(DuplicateLegError);

      expect(await prisma.ledgerTransfer.count()).toBe(0);
    });

    it('refuses a transfer that does not sum to zero', async () => {
      await expect(
        prisma.$transaction((tx) =>
          ledger.post(tx, {
            kind: 'ADJUSTMENT',
            idempotencyKey: `unbalanced-${randomUUID()}`,
            legs: [
              { walletId: buyerWalletId, amount: money('10000') },
              { walletId: escrowId, amount: money('9000') },
            ],
          }),
        ),
      ).rejects.toBeInstanceOf(UnbalancedTransferError);

      expect(await prisma.ledgerTransfer.count()).toBe(0);
    });

    it('refuses an unknown wallet with WalletNotFoundError', async () => {
      await expect(
        prisma.$transaction((tx) =>
          ledger.post(tx, {
            kind: 'ADJUSTMENT',
            idempotencyKey: `ghost-${randomUUID()}`,
            legs: [
              { walletId: randomUUID(), amount: money('-10000') },
              { walletId: escrowId, amount: money('10000') },
            ],
          }),
        ),
      ).rejects.toBeInstanceOf(WalletNotFoundError);
    });

    it('fails a short wallet with InsufficientFundsError and rolls the whole transfer back', async () => {
      await fund('100000');

      await expect(
        prisma.$transaction((tx) =>
          ledger.post(tx, {
            kind: 'ORDER_PAYMENT',
            idempotencyKey: `overdraft-${randomUUID()}`,
            legs: [
              { walletId: buyerWalletId, amount: money('-100001') },
              { walletId: escrowId, amount: money('100001') },
            ],
          }),
        ),
      ).rejects.toBeInstanceOf(InsufficientFundsError);

      // No half-written transfer: the transfer row insert must have rolled back.
      expect(await prisma.ledgerEntry.count()).toBe(2); // only the seed deposit
      expect((await userBalance(prisma, buyerId)).toFixed(0)).toBe('100000');
      expect((await systemBalance(prisma, 'ESCROW')).toFixed(0)).toBe('0');
    });

    it('moves money with a balanced transfer and records balanceAfter', async () => {
      await fund('100000');

      await prisma.$transaction((tx) =>
        ledger.post(tx, {
          kind: 'ORDER_PAYMENT',
          idempotencyKey: `pay-${randomUUID()}`,
          legs: [
            { walletId: buyerWalletId, amount: money('-100000') },
            { walletId: escrowId, amount: money('100000') },
          ],
        }),
      );

      expect((await userBalance(prisma, buyerId)).toFixed(0)).toBe('0');
      expect((await systemBalance(prisma, 'ESCROW')).toFixed(0)).toBe('100000');

      const escrowEntry = await prisma.ledgerEntry.findFirstOrThrow({
        where: { walletId: escrowId },
        orderBy: { createdAt: 'desc' },
      });
      expect(escrowEntry.balanceAfter.toFixed(0)).toBe('100000');
    });

    it('reverses a transfer with a mirror image and refuses to reverse twice', async () => {
      const deposit = await fund('100000');
      const reverse = () =>
        prisma.$transaction((tx) => ledger.reverse(tx, deposit.transferId, 'test correction', null));

      await reverse();
      expect((await userBalance(prisma, buyerId)).toFixed(0)).toBe('0');
      expect((await systemBalance(prisma, 'GATEWAY_CLEARING')).toFixed(0)).toBe('0');

      await expect(reverse()).rejects.toBeInstanceOf(AlreadyReversedError);

      const original = await prisma.ledgerTransfer.findUniqueOrThrow({
        where: { id: deposit.transferId },
      });
      expect(original.status).toBe('REVERSED');

      // Every entry across every transfer still nets to zero.
      const [{ total }] = await prisma.$queryRaw<Array<{ total: Prisma.Decimal }>>`
        select coalesce(sum(amount), 0) as total from "LedgerEntry"
      `;
      expect(total.isZero()).toBe(true);
    });
  });
});
