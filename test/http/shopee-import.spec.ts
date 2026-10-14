import { randomUUID } from 'node:crypto';
import ExcelJS from 'exceljs';
import request from 'supertest';

import { resetDatabase, resetShopeeState, seedUser } from '../helpers/test-db';
import { createTestApp, TestApp } from '../helpers/test-app';
import { signTestToken } from '../helpers/test-token';

const BASE = '/api/v1';
const IMPORT_URL = `${BASE}/admin/shopee/import`;
const HEADER = ['ID sản phẩm', 'Tên sản phẩm', 'Giá', 'Tồn kho', 'Ảnh 1'];
const SHOP_FIELD = { shopeeShopId: '38003654' };

async function xlsxBuffer(rows: Array<Array<string | number>>): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Products');
  for (const row of rows) sheet.addRow(row);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function csvBuffer(...lines: string[]): Buffer {
  return Buffer.from(lines.join('\n'), 'utf8');
}

describe('HTTP: POST /admin/shopee/import', () => {
  let ctx: TestApp;
  let staffToken: string;
  let adminToken: string;
  let userToken: string;

  function importFile(
    buffer: Buffer,
    filename: string,
    options: {
      token?: string;
      key?: string | null;
      fields?: Record<string, string>;
    } = {},
  ) {
    let call = request(ctx.app.getHttpServer())
      .post(IMPORT_URL)
      .set('Authorization', `Bearer ${options.token ?? staffToken}`)
      .attach('file', buffer, filename);
    if (options.key !== null) call = call.set('Idempotency-Key', options.key ?? randomUUID());
    for (const [name, value] of Object.entries(options.fields ?? {})) {
      call = call.field(name, value);
    }
    return call;
  }

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);

    const staffId = await seedUser(ctx.prisma, 'sync-staff@example.com');
    const adminId = await seedUser(ctx.prisma, 'sync-admin@example.com');
    const userId = await seedUser(ctx.prisma, 'sync-user@example.com');
    await ctx.prisma.userProfile.update({ where: { id: staffId }, data: { role: 'STAFF' } });
    await ctx.prisma.userProfile.update({ where: { id: adminId }, data: { role: 'ADMIN' } });

    staffToken = signTestToken({ sub: staffId });
    adminToken = signTestToken({ sub: adminId });
    userToken = signTestToken({ sub: userId });
  });

  beforeEach(async () => {
    await resetShopeeState(ctx.prisma);
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  it('imports a Seller Center export and creates catalog items', async () => {
    const file = await xlsxBuffer([
      HEADER,
      [1589295236, 'Son MAC Chili', '450.000', 3, 'https://cf.shopee.vn/a.jpg'],
      [1589295237, 'Serum ABC', 250000, 0, 'https://cf.shopee.vn/b.jpg'],
    ]);

    const res = await importFile(file, 'export.xlsx', { fields: SHOP_FIELD }).expect(200);

    expect(res.body).toMatchObject({
      status: 'SUCCEEDED',
      stats: {
        receivedRows: 2,
        itemsParsed: 2,
        created: 2,
        updated: 0,
        unchanged: 0,
        errors: 0,
        notSeen: 0,
      },
      warningCount: 0,
      shop: { shopeeShopId: '38003654' },
    });

    const items = await ctx.prisma.shopeeItem.findMany({ orderBy: { itemId: 'asc' } });
    expect(items).toHaveLength(2);
    expect(items[0].itemName).toBe('Son MAC Chili');
    expect(items[0].price?.toString()).toBe('450000');
    expect(items[0].itemStatus).toBe('NORMAL');
    expect(items[0].imageUrls).toEqual(['https://cf.shopee.vn/a.jpg']);
    expect(items[0].lastSeenAt).toBeInstanceOf(Date);

    const run = await ctx.prisma.syncRun.findUniqueOrThrow({ where: { id: res.body.runId } });
    expect(run.status).toBe('SUCCEEDED');
    expect(run.provider).toBe('CSV');
    expect(run.mode).toBe('MANUAL_IMPORT');
    expect(run.finishedAt).not.toBeNull();
    expect(run.storageRef).toBe('export.xlsx');

    const shop = await ctx.prisma.shopeeShop.findUniqueOrThrow({
      where: { shopeeShopId: BigInt(38003654) },
    });
    expect(shop.lastSyncAt).not.toBeNull();
  });

  it('lets an ADMIN import as well', async () => {
    const file = await xlsxBuffer([HEADER, [1, 'Item', 1000, 1, '']]);
    const res = await importFile(file, 'export.xlsx', {
      token: adminToken,
      fields: SHOP_FIELD,
    }).expect(200);
    expect(res.body.status).toBe('SUCCEEDED');
  });

  it('updates changed items on re-import and revives NOT_SEEN items', async () => {
    const v1 = await xlsxBuffer([HEADER, [111, 'Item A', 100000, 5, '']]);
    await importFile(v1, 'v1.xlsx', { fields: SHOP_FIELD }).expect(200);

    // Giả lập lần sync trước không thấy item này.
    await ctx.prisma.shopeeItem.updateMany({ data: { itemStatus: 'NOT_SEEN' } });

    const v2 = await xlsxBuffer([HEADER, [111, 'Item A', 120000, 4, '']]);
    const res = await importFile(v2, 'v2.xlsx', { fields: SHOP_FIELD }).expect(200);
    expect(res.body.stats).toMatchObject({ updated: 1, unchanged: 0, notSeen: 0 });

    const item = await ctx.prisma.shopeeItem.findFirstOrThrow();
    expect(item.itemStatus).toBe('NORMAL');
    expect(item.price?.toString()).toBe('120000');
    expect(item.stock).toBe(4);

    const again = await importFile(v2, 'v2.xlsx', { fields: SHOP_FIELD }).expect(200);
    expect(again.body.stats).toMatchObject({ updated: 0, unchanged: 1 });
  });

  it('marks items missing from the file as NOT_SEEN without deleting them', async () => {
    const two = await xlsxBuffer([
      HEADER,
      [201, 'Item A', 1000, 1, ''],
      [202, 'Item B', 2000, 1, ''],
    ]);
    await importFile(two, 'two.xlsx', { fields: SHOP_FIELD }).expect(200);

    const one = await xlsxBuffer([HEADER, [201, 'Item A', 1000, 1, '']]);
    const res = await importFile(one, 'one.xlsx', { fields: SHOP_FIELD }).expect(200);

    expect(res.body.stats).toMatchObject({ notSeen: 1, unchanged: 1, updated: 0 });
    const missing = await ctx.prisma.shopeeItem.findFirstOrThrow({ where: { itemId: BigInt(202) } });
    expect(missing.itemStatus).toBe('NOT_SEEN');
    expect(await ctx.prisma.shopeeItem.count()).toBe(2);

    // Xuất hiện lại -> trạng thái quay về NORMAL.
    const revived = await importFile(two, 'two.xlsx', { fields: SHOP_FIELD }).expect(200);
    expect(revived.body.stats).toMatchObject({ updated: 1, unchanged: 1 });
    const back = await ctx.prisma.shopeeItem.findFirstOrThrow({ where: { itemId: BigInt(202) } });
    expect(back.itemStatus).toBe('NORMAL');
  });

  it('records row errors, keeps good rows, and finishes PARTIAL', async () => {
    const file = csvBuffer(
      'ID sản phẩm,Tên sản phẩm,Giá,Tồn kho',
      '301,Good item,100000,1',
      '302,Bad price,abc,1',
    );

    const res = await importFile(file, 'export.csv', { fields: SHOP_FIELD }).expect(200);

    expect(res.body.status).toBe('PARTIAL');
    expect(res.body.warningCount).toBe(1);
    expect(res.body.warnings[0]).toMatchObject({ row: 2, code: 'INVALID_PRICE' });
    expect(res.body.stats).toMatchObject({ created: 1, errors: 1, notSeen: 0 });

    const errors = await ctx.prisma.syncError.findMany({ where: { runId: res.body.runId } });
    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe('INVALID_PRICE');
    expect(await ctx.prisma.shopeeItem.count()).toBe(1);
  });

  it('rejects a file without required columns before creating a run', async () => {
    const res = await importFile(csvBuffer('Tên sản phẩm,Giá', 'Son ABC,100000'), 'bad.csv', {
      fields: SHOP_FIELD,
    }).expect(422);

    expect(res.body.code).toBe('IMPORT_COLUMNS_MISSING');
    expect(await ctx.prisma.syncRun.count()).toBe(0);
    expect(await ctx.prisma.shopeeShop.count()).toBe(0);
  });

  it('rejects legacy .xls and empty files', async () => {
    const ole2 = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x00, 0x00]);
    const legacy = await importFile(ole2, 'export.xls', { fields: SHOP_FIELD }).expect(422);
    expect(legacy.body.code).toBe('IMPORT_FILE_INVALID');

    const empty = await importFile(Buffer.alloc(0), 'empty.csv', { fields: SHOP_FIELD }).expect(422);
    expect(empty.body.code).toBe('IMPORT_FILE_INVALID');
    expect(await ctx.prisma.syncRun.count()).toBe(0);
  });

  it('rejects a request without the file part', async () => {
    const res = await request(ctx.app.getHttpServer())
      .post(IMPORT_URL)
      .set('Authorization', `Bearer ${staffToken}`)
      .set('Idempotency-Key', randomUUID())
      .field('shopeeShopId', SHOP_FIELD.shopeeShopId)
      .expect(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('rejects an invalid shopeeShopId with VALIDATION_ERROR', async () => {
    const file = await xlsxBuffer([HEADER, [1, 'Item', 1000, 1, '']]);
    const res = await importFile(file, 'export.xlsx', {
      fields: { shopeeShopId: 'not-a-number' },
    }).expect(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('fails with SHOPEE_NOT_CONNECTED when no shop id is provided or configured', async () => {
    const file = await xlsxBuffer([HEADER, [1, 'Item', 1000, 1, '']]);
    const res = await importFile(file, 'export.xlsx').expect(409);
    expect(res.body.code).toBe('SHOPEE_NOT_CONNECTED');
    expect(await ctx.prisma.syncRun.count()).toBe(0);
  });

  it('forbids regular users', async () => {
    const file = await xlsxBuffer([HEADER, [1, 'Item', 1000, 1, '']]);
    const res = await importFile(file, 'export.xlsx', {
      token: userToken,
      fields: SHOP_FIELD,
    }).expect(403);
    expect(res.body.code).toBe('FORBIDDEN');
    expect(await ctx.prisma.syncRun.count()).toBe(0);
  });

  it('requires authentication', async () => {
    const file = await xlsxBuffer([HEADER, [1, 'Item', 1000, 1, '']]);
    await request(ctx.app.getHttpServer())
      .post(IMPORT_URL)
      .set('Idempotency-Key', randomUUID())
      .attach('file', file, 'export.xlsx')
      .expect(401);
  });

  it('requires the Idempotency-Key header', async () => {
    const file = await xlsxBuffer([HEADER, [1, 'Item', 1000, 1, '']]);
    const res = await importFile(file, 'export.xlsx', { key: null, fields: SHOP_FIELD }).expect(400);
    expect(res.body.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });

  it('replays the stored response for the same Idempotency-Key', async () => {
    const file = await xlsxBuffer([HEADER, [401, 'Item', 1000, 1, '']]);
    const key = randomUUID();

    const first = await importFile(file, 'export.xlsx', { fields: SHOP_FIELD, key }).expect(200);
    const replay = await importFile(file, 'export.xlsx', { fields: SHOP_FIELD, key }).expect(200);

    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect(replay.body).toEqual(first.body);
    expect(await ctx.prisma.syncRun.count()).toBe(1);
    expect(await ctx.prisma.shopeeItem.count()).toBe(1);
  });

  it('rejects while another sync run is in flight', async () => {
    await ctx.prisma.syncRun.create({
      data: { provider: 'CSV', mode: 'MANUAL_IMPORT', status: 'RUNNING' },
    });
    const file = await xlsxBuffer([HEADER, [1, 'Item', 1000, 1, '']]);

    const res = await importFile(file, 'export.xlsx', { fields: SHOP_FIELD }).expect(409);
    expect(res.body.code).toBe('SYNC_ALREADY_RUNNING');
  });

  it('marks a stale RUNNING run as FAILED and proceeds', async () => {
    const stale = await ctx.prisma.syncRun.create({
      data: {
        provider: 'CSV',
        mode: 'MANUAL_IMPORT',
        status: 'RUNNING',
        startedAt: new Date(Date.now() - 31 * 60 * 1000),
      },
    });
    const file = await xlsxBuffer([HEADER, [1, 'Item', 1000, 1, '']]);

    const res = await importFile(file, 'export.xlsx', { fields: SHOP_FIELD }).expect(200);
    expect(res.body.status).toBe('SUCCEEDED');

    const staleAfter = await ctx.prisma.syncRun.findUniqueOrThrow({ where: { id: stale.id } });
    expect(staleAfter.status).toBe('FAILED');
  });
});