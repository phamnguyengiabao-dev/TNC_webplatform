import ExcelJS from 'exceljs';

import { AppError } from '../../../../common/errors/app-error';
import { CsvShopeeProvider } from './csv-shopee.provider';

const provider = new CsvShopeeProvider();

function csvBuffer(...lines: string[]): Buffer {
  return Buffer.from(lines.join('\n'), 'utf8');
}

describe('CsvShopeeProvider', () => {
  it('parses a VN export with dotted prices, stock and image columns', async () => {
    const parsed = await provider.parse(
      csvBuffer(
        'Mã sản phẩm,Tên sản phẩm,Giá,Tồn kho,Ảnh 1,Ảnh 2',
        '1589295236,Son MAC Chili,450.000,3,https://cf.shopee.vn/a.jpg,https://cf.shopee.vn/b.jpg',
        ', ,,,',
      ),
      'export.csv',
    );

    expect(parsed.errors).toEqual([]);
    expect(parsed.receivedRows).toBe(1);
    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0]).toMatchObject({
      shopeeItemId: '1589295236',
      name: 'Son MAC Chili',
      status: 'NORMAL',
      price: '450000.00',
      stock: 3,
      imageUrls: ['https://cf.shopee.vn/a.jpg', 'https://cf.shopee.vn/b.jpg'],
    });
    expect(parsed.seenItemIds).toEqual(['1589295236']);
    expect(parsed.columns.itemId).toBe('Mã sản phẩm');
  });

  it('parses EN headers and thousands separators in prices', async () => {
    const parsed = await provider.parse(
      csvBuffer('Item ID,Product Name,Price,Stock', '999,Serum ABC,"1,234,567",10', '1000,Set mini,"1.234.567,89",2'),
      'export.csv',
    );

    expect(parsed.errors).toEqual([]);
    expect(parsed.items).toHaveLength(2);
    expect(parsed.items[0]).toMatchObject({ shopeeItemId: '999', price: '1234567.00', stock: 10 });
    expect(parsed.items[1]).toMatchObject({ price: '1234567.89', stock: 2 });
  });

  it('groups model rows into one item and derives price range plus summed stock', async () => {
    const parsed = await provider.parse(
      csvBuffer(
        'ID sản phẩm,Tên sản phẩm,Mã phân loại,Tên phân loại,Giá,Tồn kho',
        '111,Son ABC,11101,Đỏ,450000,2',
        '111,Son ABC,11102,Hồng,480.000,1',
      ),
      'export.csv',
    );

    expect(parsed.errors).toEqual([]);
    expect(parsed.items).toHaveLength(1);
    const item = parsed.items[0];
    expect(item).toMatchObject({
      shopeeItemId: '111',
      price: '450000.00',
      priceMin: '450000.00',
      priceMax: '480000.00',
      stock: 3,
    });
    expect(item.models?.map((model) => model.modelId)).toEqual(['11101', '11102']);
    expect(item.models?.[1]).toMatchObject({ name: 'Hồng', price: '480000.00', stock: 1 });
  });

  it('collects row errors without failing the file and keeps ids of errored rows as seen', async () => {
    const parsed = await provider.parse(
      csvBuffer(
        'ID sản phẩm,Tên sản phẩm,Giá,Tồn kho,Trạng thái',
        'abc,Sản phẩm lỗi id,100000,1,Đang bán',
        '222,,100000,1,Đang bán',
        '333,Giá lỗi,abc,1,Đang bán',
        '444,Trạng thái lạ,100000,1,Ngừng bán',
        '555,Đã xoá,100000,1,Đã xóa',
      ),
      'export.csv',
    );

    expect(parsed.receivedRows).toBe(5);
    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0]).toMatchObject({ shopeeItemId: '555', status: 'DELETED' });
    expect(parsed.errors.map((error) => error.code)).toEqual([
      'INVALID_ITEM_ID',
      'MISSING_NAME',
      'INVALID_PRICE',
      'UNKNOWN_STATUS',
    ]);
    expect(parsed.errors.map((error) => error.row)).toEqual([1, 2, 3, 4]);
    expect(parsed.seenItemIds).toEqual(['222', '333', '444', '555']);
  });

  it('reports duplicate rows and duplicate model ids', async () => {
    const parsed = await provider.parse(
      csvBuffer(
        'ID sản phẩm,Tên sản phẩm,Mã phân loại,Giá,Tồn kho',
        '666,Item A,M1,1000,1',
        '666,Item A,M1,1000,1',
        '666,Item A,,1200,5',
      ),
      'export.csv',
    );

    expect(parsed.items).toHaveLength(1);
    expect(parsed.errors.map((error) => error.code)).toEqual([
      'DUPLICATE_MODEL_ID',
      'DUPLICATE_ITEM_ROW',
    ]);
  });

  it('rejects a file missing required columns with IMPORT_COLUMNS_MISSING', async () => {
    await expect(
      provider.parse(csvBuffer('Tên sản phẩm,Giá', 'Son ABC,100000'), 'missing.csv'),
    ).rejects.toMatchObject({ code: 'IMPORT_COLUMNS_MISSING' });

    await expect(
      provider.parse(csvBuffer('ID sản phẩm,Giá', '123,100000'), 'missing-name.csv'),
    ).rejects.toMatchObject({ code: 'IMPORT_COLUMNS_MISSING' });
  });

  it('finds the header row below a title row and skips blank rows', async () => {
    const parsed = await provider.parse(
      csvBuffer('Danh sách sản phẩm', '', 'ID sản phẩm,Tên sản phẩm,Giá', '', '777,Item A,100000'),
      'export.csv',
    );

    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0].shopeeItemId).toBe('777');
  });

  it('handles BOM and semicolon-delimited CSV', async () => {
    const parsed = await provider.parse(
      Buffer.from('\uFEFFID sản phẩm;Tên sản phẩm;Giá\n888;Item A;100.000', 'utf8'),
      'export.csv',
    );

    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0]).toMatchObject({ shopeeItemId: '888', price: '100000.00' });
  });

  it('parses an xlsx workbook including numeric cells', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Products');
    sheet.addRow(['ID sản phẩm', 'Tên sản phẩm', 'Giá', 'Tồn kho']);
    sheet.addRow([1589295236, 'Son X', 450000, 2]);
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

    const parsed = await provider.parse(buffer, 'export.xlsx');

    expect(parsed.errors).toEqual([]);
    expect(parsed.items[0]).toMatchObject({
      shopeeItemId: '1589295236',
      name: 'Son X',
      price: '450000.00',
      stock: 2,
    });
  });

  it('rejects empty, binary, legacy-xls and all-invalid files', async () => {
    await expect(provider.parse(Buffer.alloc(0), 'empty.csv')).rejects.toMatchObject({
      code: 'IMPORT_FILE_INVALID',
    });
    await expect(
      provider.parse(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]), 'image.png'),
    ).rejects.toMatchObject({ code: 'IMPORT_FILE_INVALID' });
    await expect(
      provider.parse(
        Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x00, 0x00]),
        'export.xls',
      ),
    ).rejects.toMatchObject({ code: 'IMPORT_FILE_INVALID' });
    await expect(
      provider.parse(csvBuffer('ID sản phẩm,Tên sản phẩm', 'abc,Item A'), 'invalid.csv'),
    ).rejects.toMatchObject({ code: 'IMPORT_FILE_INVALID' });
  });

  it('builds canonical Shopee buy urls and refuses remote fetch', async () => {
    expect(
      provider.buildBuyUrl({ shopeeShopId: '38003654', shopeeItemId: '1589295236' }),
    ).toBe('https://shopee.vn/product/38003654/1589295236');

    const failure = provider.fetchCatalog();
    await expect(failure).rejects.toBeInstanceOf(AppError);
    await expect(failure).rejects.toMatchObject({ code: 'SHOPEE_NOT_CONNECTED' });
  });
});