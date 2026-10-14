import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import ExcelJS from 'exceljs';
import { Readable } from 'node:stream';

import { AppError } from '../../../../common/errors/app-error';
import {
  COLUMN_ALIASES,
  CatalogField,
  HEADER_SCAN_ROWS,
  IMAGE_COLUMN_PATTERN,
  IMPORT_MAX_ROWS,
  REQUIRED_COLUMNS,
  STATUS_LOOKUP,
  normalizeHeader,
} from '../../shopee.constants';
import type {
  ItemModelSnapshot,
  ItemSnapshot,
  ShopeeItemRef,
  ShopeeSourceStatus,
  ShopeeSyncProvider,
  SyncCatalogResult,
  SyncCursor,
} from '../shopee-sync-provider.interface';
import {
  CellValue,
  cellToValue,
  parseItemIdCell,
  parseMoneyCell,
  parseStockCell,
  splitImageUrls,
} from './csv-values';

export interface ParsedRowError {
  /** Số thứ tự dòng dữ liệu (1-based, không tính dòng tiêu đề). */
  row: number;
  code: string;
  message: string;
}

export interface ParsedCatalog {
  items: ItemSnapshot[];
  /** Số dòng dữ liệu không trống (kể cả dòng lỗi). */
  receivedRows: number;
  /**
   * Mọi item id đọc được từ file - kể cả những dòng có field khác bị lỗi.
   * Sync engine dùng danh sách này để không đánh NOT_SEEN nhầm mặt hàng vừa thấy.
   */
  seenItemIds: string[];
  errors: ParsedRowError[];
  /** Cột đã nhận diện, trả kèm kết quả import để admin đối chiếu. */
  columns: Partial<Record<CatalogField, string>>;
}

interface SheetRow {
  cells: CellValue[];
}

interface DraftModel {
  modelId: string;
  name: string;
  price?: string;
  stock?: number;
}

interface DraftItem {
  shopeeItemId: string;
  name: string;
  status: ShopeeSourceStatus;
  price?: string;
  stock?: number;
  description?: string;
  shopeeUpdateTime?: Date;
  images: string[];
  models: Map<string, DraftModel>;
  rawRows: Array<{ row: number; values: Record<string, CellValue> }>;
}

const OLE2_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

/**
 * Provider CSV/Excel: parse file export từ Shopee Seller Center thành
 * `ItemSnapshot[]` cho sync engine (S2 - docs/backend/SHOPEE_SHOWROOM_BACKEND.md muc 2.4.A).
 */
@Injectable()
export class CsvShopeeProvider implements ShopeeSyncProvider {
  readonly name = 'csv' as const;

  /** CSV không kéo được catalog từ xa; xem `parse()` cho luồng import file. */
  async fetchCatalog(_cursor?: SyncCursor): Promise<SyncCatalogResult> {
    throw new AppError('SHOPEE_NOT_CONNECTED', {
      logMessage: 'CSV provider has no remote catalog; upload a Seller Center export instead',
    });
  }

  buildBuyUrl(item: ShopeeItemRef): string {
    return `https://shopee.vn/product/${item.shopeeShopId}/${item.shopeeItemId}`;
  }

  /**
   * Parse file export (xlsx hoặc csv) thành `ItemSnapshot[]`.
   *
   * Lỗi ở cấp file (không đọc được / thiếu cột / không có dòng hợp lệ) ném
   * AppError; lỗi ở cấp dòng được gom vào `errors` để một dòng hỏng không làm
   * hỏng cả file import.
   */
  async parse(buffer: Buffer, filename: string): Promise<ParsedCatalog> {
    const rows = await this.readRows(buffer, filename);
    const headerIndex = this.findHeaderRow(rows);
    if (headerIndex < 0) {
      throw new AppError('IMPORT_COLUMNS_MISSING', {
        logMessage: `no header row with required columns found in ${filename}`,
        detail: 'Không tìm thấy dòng tiêu đề với cột "ID sản phẩm"/"Mã sản phẩm" và "Tên sản phẩm".',
      });
    }

    const header = rows[headerIndex].cells;
    const { columnIndex, headers, imageColumns } = this.mapColumns(header);
    const missing = REQUIRED_COLUMNS.filter((field) => columnIndex[field] === undefined);
    if (missing.length > 0) {
      throw new AppError('IMPORT_COLUMNS_MISSING', {
        logMessage: `missing required columns [${missing.join(', ')}] in ${filename}; headers=[${headers.join(' | ')}]`,
        detail: 'File import thiếu cột bắt buộc: "ID sản phẩm"/"Mã sản phẩm" hoặc "Tên sản phẩm".',
      });
    }

    const dataRows = rows.slice(headerIndex + 1);
    if (dataRows.length > IMPORT_MAX_ROWS) {
      throw new AppError('IMPORT_FILE_INVALID', {
        logMessage: `${filename} has ${dataRows.length} rows (> ${IMPORT_MAX_ROWS})`,
        detail: `File import vượt quá ${IMPORT_MAX_ROWS} dòng dữ liệu.`,
      });
    }

    const drafts = new Map<string, DraftItem>();
    const errors: ParsedRowError[] = [];
    const seenItemIds: string[] = [];
    let receivedRows = 0;
    let rowNumber = 0;

    for (const row of dataRows) {
      if (row.cells.every((cell) => cell === null)) continue;
      receivedRows += 1;
      rowNumber += 1;

      const itemId = parseItemIdCell(this.cell(row.cells, columnIndex.itemId));
      if (!itemId.ok) {
        errors.push({ row: rowNumber, code: 'INVALID_ITEM_ID', message: itemId.reason });
        continue;
      }
      seenItemIds.push(itemId.value);

      const status = this.resolveStatus(this.cell(row.cells, columnIndex.status));
      if (status === null) {
        const raw = this.cell(row.cells, columnIndex.status);
        errors.push({
          row: rowNumber,
          code: 'UNKNOWN_STATUS',
          message: `trạng thái không nhận diện được: "${String(raw)}"`,
        });
        continue;
      }

      const nameCell = this.cell(row.cells, columnIndex.name);
      const name = nameCell === null ? '' : String(nameCell).trim();
      if (!name) {
        errors.push({ row: rowNumber, code: 'MISSING_NAME', message: 'thiếu tên sản phẩm' });
        continue;
      }

      let price: string | undefined;
      const priceCell = this.cell(row.cells, columnIndex.price);
      if (priceCell !== null) {
        const parsed = parseMoneyCell(priceCell, 'giá');
        if (!parsed.ok) {
          errors.push({ row: rowNumber, code: 'INVALID_PRICE', message: parsed.reason });
          continue;
        }
        price = parsed.value;
      }

      let stock: number | undefined;
      const stockCell = this.cell(row.cells, columnIndex.stock);
      if (stockCell !== null) {
        const parsed = parseStockCell(stockCell);
        if (!parsed.ok) {
          errors.push({ row: rowNumber, code: 'INVALID_STOCK', message: parsed.reason });
          continue;
        }
        stock = parsed.value;
      }

      let modelId: string | undefined;
      let modelName: string | undefined;
      const modelIdCell = this.cell(row.cells, columnIndex.modelId);
      if (modelIdCell !== null) {
        // Model id có thể là ID số của Shopee hoặc SKU chữ do người bán đặt:
        // giữ nguyên dạng chuỗi, chỉ cần không rỗng.
        modelId = String(modelIdCell).trim() || undefined;
        if (modelId) {
          const modelNameCell = this.cell(row.cells, columnIndex.modelName);
          modelName = modelNameCell === null ? modelId : String(modelNameCell).trim();
        }
      }

      const images = this.collectImages(row.cells, imageColumns);
      const descriptionCell = this.cell(row.cells, columnIndex.description);
      const description =
        descriptionCell === null ? undefined : String(descriptionCell).trim() || undefined;
      const shopeeUpdateTime = parseDateCell(this.cell(row.cells, columnIndex.updateTime));

      const rawValues: Record<string, CellValue> = {};
      headers.forEach((headerName, index) => {
        if (headerName) rawValues[headerName] = row.cells[index] ?? null;
      });

      const draft = drafts.get(itemId.value);
      if (!draft) {
        const created: DraftItem = {
          shopeeItemId: itemId.value,
          name,
          status,
          price,
          stock,
          description,
          shopeeUpdateTime,
          images,
          models: new Map(),
          rawRows: [{ row: rowNumber, values: rawValues }],
        };
        if (modelId) {
          created.models.set(modelId, { modelId, name: modelName ?? modelId, price, stock });
        }
        drafts.set(itemId.value, created);
        continue;
      }

      if (!modelId) {
        errors.push({
          row: rowNumber,
          code: 'DUPLICATE_ITEM_ROW',
          message: `sản phẩm ${itemId.value} xuất hiện nhiều dòng không có mã phân loại`,
        });
        continue;
      }
      if (draft.models.has(modelId)) {
        errors.push({
          row: rowNumber,
          code: 'DUPLICATE_MODEL_ID',
          message: `phân loại ${modelId} của sản phẩm ${itemId.value} bị lặp lại`,
        });
        continue;
      }

      draft.models.set(modelId, { modelId, name: modelName ?? modelId, price, stock });
      if (draft.images.length === 0 && images.length > 0) draft.images = images;
      if (draft.price === undefined && price !== undefined) draft.price = price;
      if (draft.stock === undefined && stock !== undefined) draft.stock = stock;
      if (!draft.shopeeUpdateTime && shopeeUpdateTime) draft.shopeeUpdateTime = shopeeUpdateTime;
      draft.rawRows.push({ row: rowNumber, values: rawValues });
    }

    const items = [...drafts.values()].map((draft) => buildSnapshot(draft));

    if (items.length === 0) {
      throw new AppError('IMPORT_FILE_INVALID', {
        logMessage: `no valid data rows in ${filename}; first errors: ${JSON.stringify(errors.slice(0, 5))}`,
        detail: 'File import không có dòng dữ liệu hợp lệ nào để đồng bộ.',
      });
    }

    return {
      items,
      receivedRows,
      seenItemIds: [...new Set(seenItemIds)],
      errors,
      columns: this.describeColumns(columnIndex, headers),
    };
  }

  private async readRows(buffer: Buffer, filename: string): Promise<SheetRow[]> {
    if (buffer.length === 0) {
      throw new AppError('IMPORT_FILE_INVALID', { logMessage: `empty upload ${filename}` });
    }
    if (isZip(buffer)) return this.readXlsxRows(buffer, filename);
    if (isOle2(buffer)) {
      throw new AppError('IMPORT_FILE_INVALID', {
        logMessage: `legacy .xls upload ${filename}`,
        detail:
          'File .xls (Excel 97-2003) chưa được hỗ trợ. Mở bằng Excel, lưu sang .xlsx hoặc .csv rồi import lại.',
      });
    }
    return this.readCsvRows(buffer, filename);
  }

  private async readXlsxRows(buffer: Buffer, filename: string): Promise<SheetRow[]> {
    let sheet: ExcelJS.Worksheet | undefined;
    try {
      const workbook = new ExcelJS.Workbook();
      // exceljs khai báo tham số load() là `Buffer extends ArrayBuffer` (kiểu riêng), trong khi ta có Node Buffer.
      await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
      sheet = workbook.worksheets[0];
    } catch (error) {
      throw new AppError('IMPORT_FILE_INVALID', {
        logMessage: `cannot read xlsx ${filename}: ${describe(error)}`,
        detail: 'File Excel không đọc được. Hãy export lại từ Seller Center và thử lại.',
      });
    }
    if (!sheet) {
      throw new AppError('IMPORT_FILE_INVALID', {
        logMessage: `xlsx ${filename} has no worksheet`,
      });
    }
    return this.worksheetToRows(sheet);
  }

  private async readCsvRows(buffer: Buffer, filename: string): Promise<SheetRow[]> {
    const text = decodeText(buffer);
    if (text.slice(0, 2000).includes('\u0000')) {
      throw new AppError('IMPORT_FILE_INVALID', {
        logMessage: `binary upload ${filename} is neither csv nor xlsx`,
        detail: 'File không phải CSV/Excel hợp lệ.',
      });
    }
    try {
      const workbook = new ExcelJS.Workbook();
      const sheet = await workbook.csv.read(Readable.from([text]), {
        parserOptions: { delimiter: detectDelimiter(text) },
        // Mặc định exceljs tự đổi "450.000" thành number 450 và " " thành 0;
        // giữ nguyên mọi ô dạng chuỗi để parser tự diễn giải.
        map: (value: string) => value,
      });
      return this.worksheetToRows(sheet);
    } catch (error) {
      throw new AppError('IMPORT_FILE_INVALID', {
        logMessage: `cannot read csv ${filename}: ${describe(error)}`,
      });
    }
  }

  private worksheetToRows(sheet: ExcelJS.Worksheet): SheetRow[] {
    const rows: SheetRow[] = [];
    const columnCount = sheet.columnCount;
    sheet.eachRow({ includeEmpty: false }, (row) => {
      const cells: CellValue[] = [];
      for (let column = 1; column <= columnCount; column += 1) {
        cells.push(cellToValue(row.getCell(column).value));
      }
      rows.push({ cells });
    });
    return rows;
  }

  private findHeaderRow(rows: SheetRow[]): number {
    const limit = Math.min(rows.length, HEADER_SCAN_ROWS);
    for (let index = 0; index < limit; index += 1) {
      const { columnIndex } = this.mapColumns(rows[index].cells);
      if (REQUIRED_COLUMNS.every((field) => columnIndex[field] !== undefined)) return index;
    }
    return -1;
  }

  private mapColumns(header: CellValue[]): {
    columnIndex: Partial<Record<CatalogField, number>>;
    headers: string[];
    imageColumns: number[];
  } {
    const headers = header.map((cell) => (cell === null ? '' : String(cell)));
    const normalized = headers.map(normalizeHeader);
    const columnIndex: Partial<Record<CatalogField, number>> = {};
    const taken = new Set<number>();

    for (const [field, aliases] of Object.entries(COLUMN_ALIASES) as Array<
      [CatalogField, readonly string[]]
    >) {
      for (const alias of aliases) {
        const index = normalized.findIndex((value, at) => value === alias && !taken.has(at));
        if (index >= 0) {
          columnIndex[field] = index;
          taken.add(index);
          break;
        }
      }
    }

    const imageColumns = normalized
      .map((value, index) => (IMAGE_COLUMN_PATTERN.test(value) && !taken.has(index) ? index : -1))
      .filter((index) => index >= 0);

    return { columnIndex, headers, imageColumns };
  }

  private cell(cells: CellValue[], index: number | undefined): CellValue {
    if (index === undefined) return null;
    return cells[index] ?? null;
  }

  private resolveStatus(value: CellValue): ShopeeSourceStatus | null {
    if (value === null) return 'NORMAL';
    const normalized = normalizeHeader(String(value));
    if (!normalized) return 'NORMAL';
    return STATUS_LOOKUP.get(normalized) ?? null;
  }

  private collectImages(cells: CellValue[], imageColumns: number[]): string[] {
    const urls: string[] = [];
    for (const column of imageColumns) urls.push(...splitImageUrls(cells[column] ?? null));
    return [...new Set(urls)];
  }

  private describeColumns(
    columnIndex: Partial<Record<CatalogField, number>>,
    headers: string[],
  ): Partial<Record<CatalogField, string>> {
    const described: Partial<Record<CatalogField, string>> = {};
    for (const [field, index] of Object.entries(columnIndex) as Array<[CatalogField, number]>) {
      described[field] = headers[index] ?? '';
    }
    return described;
  }
}

function buildSnapshot(draft: DraftItem): ItemSnapshot {
  const models: ItemModelSnapshot[] = [...draft.models.values()].sort((left, right) =>
    compareModelIds(left.modelId, right.modelId),
  );

  let price = draft.price;
  let priceMin: string | undefined;
  let priceMax: string | undefined;
  const modelPrices = models
    .map((model) => model.price)
    .filter((value): value is string => Boolean(value));
  if (modelPrices.length > 0) {
    const sorted = [...modelPrices].sort((left, right) => comparePrices(left, right));
    priceMin = sorted[0];
    priceMax = sorted[sorted.length - 1];
    price = priceMin;
  }

  let stock = draft.stock;
  const modelStocks = models.map((model) => model.stock);
  if (models.length > 0 && modelStocks.every((value): value is number => value !== undefined)) {
    stock = modelStocks.reduce((total, value) => total + value, 0);
  }

  return {
    shopeeItemId: draft.shopeeItemId,
    name: draft.name,
    status: draft.status,
    price,
    priceMin,
    priceMax,
    stock,
    imageUrls: draft.images,
    description: draft.description,
    shopeeUpdateTime: draft.shopeeUpdateTime,
    models: models.length > 0 ? models : undefined,
    raw: { rows: draft.rawRows },
  };
}

/** So sánh id phân loại dạng chuỗi (ID số của Shopee hoặc SKU người bán đặt). */
function compareModelIds(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

/** So sánh hai giá dạng chuỗi bằng Decimal (không qua Number). */
function comparePrices(left: string, right: string): number {
  return new Prisma.Decimal(left).comparedTo(new Prisma.Decimal(right));
}

function isZip(buffer: Buffer): boolean {
  return buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b;
}

function isOle2(buffer: Buffer): boolean {
  if (buffer.length < OLE2_MAGIC.length) return false;
  return OLE2_MAGIC.every((byte, index) => buffer[index] === byte);
}

function decodeText(buffer: Buffer): string {
  const text =
    buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe
      ? buffer.subarray(2).toString('utf16le')
      : buffer.toString('utf8');
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function detectDelimiter(text: string): string {
  const sample = text.split(/\r?\n/).find((line) => line.trim().length > 0) ?? '';
  const counts: Array<[string, number]> = [
    [',', (sample.match(/,/g) ?? []).length],
    [';', (sample.match(/;/g) ?? []).length],
    ['\t', (sample.match(/\t/g) ?? []).length],
  ];
  counts.sort((left, right) => right[1] - left[1]);
  return counts[0][1] > 0 ? counts[0][0] : ',';
}

function parseDateCell(value: CellValue): Date | undefined {
  if (value === null || typeof value === 'number') return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : new Date(parsed);
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}