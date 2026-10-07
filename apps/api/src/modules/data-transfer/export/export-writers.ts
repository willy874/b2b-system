import { PassThrough } from 'node:stream';

import ExcelJS from 'exceljs';

import { XLSX_MAX_CELL_LENGTH } from '../data-transfer.constants';
import type { ExportFormat, TransferColumn } from '../data-transfer.types';
import {
  escapeFormula,
  snakeCase,
  sqlType,
  toCellText,
  toSqlLiteral,
  toXlsxValue,
} from '../data-transfer.values';
import type { FormatContext } from '../data-transfer.values';

/**
 * 匯出檔的寫檔器（docs/architecture/backend/22-data-transfer.md §6.5）。寫出的位元組交給 `ByteSink`，
 * 整份檔案不放記憶體：呼叫端每寫一頁就把累積的位元組分段上傳。
 */

export interface ByteSink {
  write(chunk: Buffer): void;
}

export interface ExportWriterMeta {
  /** SQL 的表名前綴與註解。 */
  fileBaseName: string;
  /** 工作表名稱、SQL 的註解。 */
  label: string;
  generatedAt: Date;
  generatedBy: string;
}

export interface ExportWriter {
  start(): Promise<void>;
  write(records: readonly unknown[]): Promise<void>;
  /** 結束檔案；回傳被截斷的儲存格數（只有 XLSX）。 */
  finish(rows: number): Promise<{ truncatedCells: number }>;
}

type AnyColumn = TransferColumn<unknown>;

export const EXPORT_CONTENT_TYPE: Readonly<Record<ExportFormat, string>> = {
  csv: 'text/csv; charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  sql: 'application/sql; charset=utf-8',
};

function valueOf(column: AnyColumn, record: unknown): unknown {
  return column.export?.get(record);
}

// ── CSV ──

/** RFC 4180：含逗號、引號、換行（或開頭結尾空白）時加引號，引號加倍。 */
export function csvField(text: string): string {
  return /[",\r\n]|^\s|\s$/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function csvLine(fields: readonly string[]): string {
  return `${fields.map(csvField).join(',')}\r\n`;
}

/** UTF-8 加 BOM（Excel 才能正確辨識中文）、CRLF；標頭是匯出者語系的 label。 */
export class CsvExportWriter implements ExportWriter {
  constructor(
    private readonly columns: readonly AnyColumn[],
    private readonly ctx: FormatContext,
    private readonly sink: ByteSink,
  ) {}

  async start(): Promise<void> {
    this.sink.write(Buffer.from('﻿', 'utf8'));
    this.sink.write(
      Buffer.from(csvLine(this.columns.map((column) => column.label[this.ctx.locale])), 'utf8'),
    );
  }

  async write(records: readonly unknown[]): Promise<void> {
    let chunk = '';
    for (const record of records) {
      chunk += csvLine(
        this.columns.map((column) =>
          escapeFormula(column, toCellText(column, valueOf(column, record), this.ctx)),
        ),
      );
    }
    this.sink.write(Buffer.from(chunk, 'utf8'));
  }

  async finish(): Promise<{ truncatedCells: number }> {
    return { truncatedCells: 0 };
  }
}

// ── SQL ──

/** SQL 的單行註解：label 與 email 不可能換行，仍把換行換掉以防萬一。 */
function comment(text: string): string {
  return text.replaceAll(/[\r\n]+/g, ' ');
}

/**
 * PostgreSQL 的 `CREATE TABLE IF NOT EXISTS` 加多列 `INSERT`，每 500 列一個（呼叫端每頁 500 列）。
 * 表名是 `<fileBaseName>_export`、欄名是欄位 key 的 snake_case：匯出的是資源的對外欄位，不是資料表傾印。
 */
export class SqlExportWriter implements ExportWriter {
  private readonly table: string;

  constructor(
    private readonly columns: readonly AnyColumn[],
    private readonly sink: ByteSink,
    private readonly meta: ExportWriterMeta,
  ) {
    this.table = `"${meta.fileBaseName}_export"`;
  }

  private get columnList(): string {
    return this.columns.map((column) => `"${snakeCase(column.key)}"`).join(', ');
  }

  async start(): Promise<void> {
    const definitions = this.columns
      .map((column) => `  "${snakeCase(column.key)}" ${sqlType(column)}`)
      .join(',\n');
    this.sink.write(
      Buffer.from(
        `-- b2b-system export: ${comment(this.meta.fileBaseName)} (${comment(this.meta.label)})\n` +
          `-- generated at ${this.meta.generatedAt.toISOString()} by ${comment(this.meta.generatedBy)}\n` +
          `BEGIN;\nCREATE TABLE IF NOT EXISTS ${this.table} (\n${definitions}\n);\n`,
        'utf8',
      ),
    );
  }

  async write(records: readonly unknown[]): Promise<void> {
    if (records.length === 0) return;
    const rows = records.map(
      (record) =>
        `  (${this.columns.map((column) => toSqlLiteral(column, valueOf(column, record))).join(', ')})`,
    );
    this.sink.write(
      Buffer.from(
        `INSERT INTO ${this.table} (${this.columnList}) VALUES\n${rows.join(',\n')};\n`,
        'utf8',
      ),
    );
  }

  async finish(rows: number): Promise<{ truncatedCells: number }> {
    this.sink.write(Buffer.from(`-- ${rows} rows\nCOMMIT;\n`, 'utf8'));
    return { truncatedCells: 0 };
  }
}

// ── XLSX ──

const WIDTH_SAMPLE_ROWS = 100;
const MIN_WIDTH = 8;
const MAX_WIDTH = 60;

/** 字元寬：CJK 等全形字算兩格。 */
function displayWidth(text: string): number {
  let width = 0;
  for (const char of text) width += /[ᄀ-￯]/.test(char) ? 2 : 1;
  return width;
}

/**
 * `exceljs` 的串流寫檔。一個工作表，名稱是資源的 label；標頭粗體、凍結；欄寬依標頭與前 100 列估算
 * （所以第一頁先暫存，估完欄寬再寫）。字串一律是字串儲存格，不會被解讀成公式，所以不加 `'` 前綴（D16）。
 */
export class XlsxExportWriter implements ExportWriter {
  private readonly stream = new PassThrough();
  private readonly workbook: ExcelJS.stream.xlsx.WorkbookWriter;
  private sheet: ExcelJS.Worksheet | null = null;
  private truncatedCells = 0;

  constructor(
    private readonly columns: readonly AnyColumn[],
    private readonly ctx: FormatContext,
    sink: ByteSink,
    private readonly meta: ExportWriterMeta,
  ) {
    this.stream.on('data', (chunk: Buffer) => sink.write(chunk));
    this.workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
      stream: this.stream,
      useStyles: true,
      useSharedStrings: false,
    });
  }

  async start(): Promise<void> {}

  private cells(record: unknown): (string | number | Date | null)[] {
    return this.columns.map((column) => {
      const value = toXlsxValue(column, valueOf(column, record), this.ctx);
      if (typeof value === 'string' && value.length > XLSX_MAX_CELL_LENGTH) {
        this.truncatedCells += 1;
        return `${value.slice(0, XLSX_MAX_CELL_LENGTH - 1)}…`;
      }
      return value;
    });
  }

  private open(sample: readonly (string | number | Date | null)[][]): ExcelJS.Worksheet {
    // 工作表名稱不能含 \ / ? * [ ] :，最長 31 字
    const name = this.meta.label.replaceAll(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Sheet1';
    const sheet = this.workbook.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
    sheet.columns = this.columns.map((column, index) => {
      const header = column.label[this.ctx.locale];
      const widest = sample.slice(0, WIDTH_SAMPLE_ROWS).reduce((max, row) => {
        const cell = row[index];
        const text =
          cell instanceof Date ? '2026-01-01 00:00:00' : cell === null ? '' : String(cell);
        return Math.max(max, displayWidth(text));
      }, displayWidth(header));
      return {
        header,
        key: column.key,
        width: Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, widest + 2)),
        style:
          column.kind === 'date'
            ? { numFmt: 'yyyy-mm-dd' }
            : column.kind === 'datetime'
              ? { numFmt: 'yyyy-mm-dd hh:mm:ss' }
              : {},
      };
    });
    sheet.getRow(1).font = { bold: true };
    sheet.getRow(1).commit();
    return sheet;
  }

  async write(records: readonly unknown[]): Promise<void> {
    const rows = records.map((record) => this.cells(record));
    this.sheet ??= this.open(rows);
    for (const row of rows) this.sheet.addRow(row).commit();
  }

  async finish(): Promise<{ truncatedCells: number }> {
    this.sheet ??= this.open([]);
    this.sheet.commit();
    await this.workbook.commit();
    return { truncatedCells: this.truncatedCells };
  }
}

export function createExportWriter(
  format: ExportFormat,
  columns: readonly AnyColumn[],
  ctx: FormatContext,
  sink: ByteSink,
  meta: ExportWriterMeta,
): ExportWriter {
  switch (format) {
    case 'csv':
      return new CsvExportWriter(columns, ctx, sink);
    case 'xlsx':
      return new XlsxExportWriter(columns, ctx, sink, meta);
    case 'sql':
      return new SqlExportWriter(columns, sink, meta);
  }
}
