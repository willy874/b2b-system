import { isMainThread, parentPort } from 'node:worker_threads';

import { parse } from 'csv-parse/sync';
import ExcelJS from 'exceljs';
import { parse as parseYaml } from 'yaml';

/**
 * 匯入分析的讀檔器（docs/architecture/backend/22-data-transfer.md §7.3）：位元組 → 標頭＋二維字串陣列。
 * 在 worker thread 執行（`ParsePool`），不碰資料庫；驗證回到主執行緒做。
 *
 * 這個檔案會被 worker 直接載入（dist 的 .js，測試時 Node 以型別剝除執行 .ts），
 * 所以 **不 import 專案內的其他檔案**：只用 node 內建模組與套件。之後要加新格式（ODS），
 * 加一個輸出同樣形狀的讀檔器即可，其餘流程不變。JSON／YAML 的物件陣列也轉成同樣的形狀（鍵是標頭）。
 */

export type SheetFormat = 'csv' | 'xlsx' | 'json' | 'yaml';
export type SheetEncoding = 'auto' | 'utf-8' | 'big5' | 'utf-16';

export interface ReadSheetOptions {
  format: SheetFormat;
  encoding: SheetEncoding;
  /** XLSX：指定的工作表名稱；沒有就讀第一個。 */
  sheet?: string;
}

export interface SheetRow {
  /** 檔案中的實際列號（1 起，含標頭）。 */
  sourceRow: number;
  cells: string[];
}

export interface SheetWarning {
  sourceRow: number;
  column: number;
  code: 'formulaWithoutValue';
}

export type ReadSheetResult =
  | {
      ok: true;
      header: string[];
      /** 標頭之後的非空白列。 */
      rows: SheetRow[];
      /** XLSX 的所有工作表（有多個時，前端讓使用者改選）。 */
      sheets?: string[];
      warnings: SheetWarning[];
      encoding?: string;
    }
  | { ok: false; reason: 'unreadable' | 'noHeader' | 'sheetNotFound' | 'encrypted' };

// ── CSV ──

/** 依 BOM 判斷；沒有 BOM 時先以嚴格的 UTF-8 解碼，失敗再用 Big5（繁中 Windows 的 Excel 另存 CSV 的預設）。 */
export function decodeText(
  bytes: Uint8Array,
  encoding: SheetEncoding,
): { text: string; encoding: string } {
  const decode = (label: string, start = 0, fatal = false) =>
    new TextDecoder(label, { fatal }).decode(bytes.subarray(start));
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { text: decode('utf-8', 3), encoding: 'utf-8' };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xfe)
    return { text: decode('utf-16le', 2), encoding: 'utf-16le' };
  if (bytes[0] === 0xfe && bytes[1] === 0xff)
    return { text: decode('utf-16be', 2), encoding: 'utf-16be' };
  if (encoding === 'big5') return { text: decode('big5'), encoding: 'big5' };
  if (encoding === 'utf-16') return { text: decode('utf-16le'), encoding: 'utf-16le' };
  if (encoding === 'utf-8') return { text: decode('utf-8'), encoding: 'utf-8' };
  try {
    return { text: decode('utf-8', 0, true), encoding: 'utf-8' };
  } catch {
    // 不是合法的 UTF-8：退回 Big5
    return { text: decode('big5'), encoding: 'big5' };
  }
}

/** 分隔字元：第一個非空白列中 `,`、`;`、Tab 出現最多的（從 Excel 貼成 TSV 的也能讀）；引號內的不算。 */
export function detectDelimiter(text: string): string {
  const line = text.split(/\r?\n/).find((item) => item.trim() !== '') ?? '';
  const counts = new Map<string, number>([
    [',', 0],
    [';', 0],
    ['\t', 0],
  ]);
  let quoted = false;
  for (const char of line) {
    if (char === '"') quoted = !quoted;
    else if (!quoted && counts.has(char)) counts.set(char, (counts.get(char) ?? 0) + 1);
  }
  let best = ',';
  for (const [delimiter, count] of counts) {
    if (count > (counts.get(best) ?? 0)) best = delimiter;
  }
  return best;
}

function isBlank(cells: readonly string[]): boolean {
  return cells.every((cell) => cell.trim() === '');
}

/** 空白列略過、不佔列號；第一個非空白列是標頭。 */
function splitHeader(records: { sourceRow: number; cells: string[] }[]) {
  const content = records.filter((record) => !isBlank(record.cells));
  const [header, ...rows] = content;
  return header ? { header: header.cells.map((cell) => cell.trim()), rows } : null;
}

export function readCsv(bytes: Uint8Array, encoding: SheetEncoding): ReadSheetResult {
  const decoded = decodeText(bytes, encoding);
  let records: string[][];
  try {
    records = parse(decoded.text, {
      delimiter: detectDelimiter(decoded.text),
      relax_column_count: true,
      relax_quotes: true,
      skip_empty_lines: false,
      bom: true,
    }) as string[][];
  } catch {
    return { ok: false, reason: 'unreadable' };
  }
  const split = splitHeader(records.map((cells, index) => ({ sourceRow: index + 1, cells })));
  if (!split) return { ok: false, reason: 'noHeader' };
  return {
    ok: true,
    header: split.header,
    rows: split.rows,
    warnings: [],
    encoding: decoded.encoding,
  };
}

// ── XLSX ──

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/**
 * XLSX 的日期是「牆上時間」（沒有時區；exceljs 以 UTC 欄位表示）：只有日期 → `YYYY-MM-DD`；
 * 有時間 → 沒有時差的 `YYYY-MM-DDTHH:mm:ss`，由驗證器以建立匯入的人的時區解讀（§5.3）。
 */
function dateText(date: Date): string {
  const day = `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
  if (date.getUTCHours() === 0 && date.getUTCMinutes() === 0 && date.getUTCSeconds() === 0)
    return day;
  return `${day}T${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
}

type CellValue = ExcelJS.CellValue;

function cellText(value: CellValue): { text: string; formulaWithoutValue?: true } {
  if (value === null || value === undefined) return { text: '' };
  if (typeof value === 'string') return { text: value };
  if (typeof value === 'number') return { text: String(value) };
  if (typeof value === 'boolean') return { text: value ? 'true' : 'false' };
  if (value instanceof Date) return { text: dateText(value) };
  if (typeof value === 'object') {
    // 公式：取快取的計算結果；沒有結果的視為空白並警告
    if ('formula' in value || 'sharedFormula' in value) {
      const result = (value as { result?: CellValue }).result;
      if (result === undefined || result === null) return { text: '', formulaWithoutValue: true };
      if (typeof result === 'object' && !(result instanceof Date) && 'error' in result) {
        return { text: String((result as { error: string }).error) };
      }
      return cellText(result);
    }
    if ('richText' in value) return { text: value.richText.map((part) => part.text).join('') };
    if ('text' in value && typeof value.text === 'string') return { text: value.text };
    if ('error' in value) return { text: String(value.error) };
  }
  return { text: String(value) };
}

export async function readXlsx(bytes: Uint8Array, sheetName?: string): Promise<ReadSheetResult> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(
      Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength) as never,
    );
  } catch (error) {
    // 加密的 XLSX 是 OLE 容器，不是 zip
    const message = error instanceof Error ? error.message : '';
    return {
      ok: false,
      reason: /zip|signature|end of central/i.test(message) ? 'encrypted' : 'unreadable',
    };
  }
  const sheets = workbook.worksheets.map((sheet) => sheet.name);
  const worksheet = sheetName ? workbook.getWorksheet(sheetName) : workbook.worksheets[0];
  if (!worksheet) return { ok: false, reason: sheetName ? 'sheetNotFound' : 'noHeader' };
  const records: { sourceRow: number; cells: string[] }[] = [];
  const warnings: SheetWarning[] = [];
  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    const cells: string[] = [];
    row.eachCell({ includeEmpty: true }, (cell, columnNumber) => {
      const { text, formulaWithoutValue } = cellText(cell.value);
      cells[columnNumber - 1] = text;
      if (formulaWithoutValue)
        warnings.push({
          sourceRow: rowNumber,
          column: columnNumber - 1,
          code: 'formulaWithoutValue',
        });
    });
    records.push({ sourceRow: rowNumber, cells: Array.from(cells, (cell) => cell ?? '') });
  });
  const split = splitHeader(records);
  if (!split) return { ok: false, reason: 'noHeader' };
  return { ok: true, header: split.header, rows: split.rows, sheets, warnings };
}

// ── JSON／YAML ──

/** 多值的分隔字元（與 `MULTI_VALUE_SEPARATOR` 相同；這個檔案不 import 專案內的檔案）。 */
const SEPARATOR = ';';

/** 結構化的值 → 儲存格文字：陣列以 `;` 串接（多值欄）、`null` 是空白、物件是 JSON。 */
export function dataCellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  if (value instanceof Date) return dateText(value);
  if (Array.isArray(value)) {
    return value
      .map((item) =>
        typeof item === 'object' && item !== null ? JSON.stringify(item) : dataCellText(item),
      )
      .filter((item) => item !== '')
      .join(SEPARATOR);
  }
  return JSON.stringify(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 物件陣列 → 標頭＋列：最上層是陣列，或只有一個陣列屬性的物件（例：`{ "users": [...] }`）。
 * 標頭是所有物件的鍵（依第一次出現的順序）；列號是陣列中的第幾筆（1 起）。
 */
export function readRecords(data: unknown): ReadSheetResult {
  let items: unknown = data;
  if (isRecord(data)) {
    const arrays = Object.values(data).filter(Array.isArray);
    if (arrays.length !== 1) return { ok: false, reason: 'unreadable' };
    items = arrays[0];
  }
  if (!Array.isArray(items) || !items.every(isRecord)) return { ok: false, reason: 'unreadable' };
  const header: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    for (const key of Object.keys(item)) {
      if (!seen.has(key)) {
        seen.add(key);
        header.push(key);
      }
    }
  }
  if (header.length === 0) return { ok: false, reason: 'noHeader' };
  const rows: SheetRow[] = [];
  items.forEach((item, index) => {
    const cells = header.map((key) => dataCellText(item[key]));
    if (!isBlank(cells)) rows.push({ sourceRow: index + 1, cells });
  });
  return { ok: true, header: header.map((key) => key.trim()), rows, warnings: [] };
}

export function readJson(bytes: Uint8Array, encoding: SheetEncoding): ReadSheetResult {
  const decoded = decodeText(bytes, encoding);
  let data: unknown;
  try {
    data = JSON.parse(decoded.text);
  } catch {
    return { ok: false, reason: 'unreadable' };
  }
  const result = readRecords(data);
  return result.ok ? { ...result, encoding: decoded.encoding } : result;
}

export function readYaml(bytes: Uint8Array, encoding: SheetEncoding): ReadSheetResult {
  const decoded = decodeText(bytes, encoding);
  let data: unknown;
  try {
    // YAML 1.2 core schema：`2026-10-08` 仍是字串（不轉成 Date）；別名數量有上限，防止展開攻擊
    data = parseYaml(decoded.text, { maxAliasCount: 100 });
  } catch {
    return { ok: false, reason: 'unreadable' };
  }
  const result = readRecords(data);
  return result.ok ? { ...result, encoding: decoded.encoding } : result;
}

export async function readSheet(
  bytes: Uint8Array,
  options: ReadSheetOptions,
): Promise<ReadSheetResult> {
  switch (options.format) {
    case 'xlsx':
      return readXlsx(bytes, options.sheet);
    case 'json':
      return readJson(bytes, options.encoding);
    case 'yaml':
      return readYaml(bytes, options.encoding);
    default:
      return readCsv(bytes, options.encoding);
  }
}

// ── worker thread 的進入點 ──

export interface ParseRequest {
  id: number;
  bytes: Uint8Array;
  options: ReadSheetOptions;
}

export type ParseResponse = { id: number; result: ReadSheetResult } | { id: number; error: string };

if (!isMainThread && parentPort) {
  const port = parentPort;
  port.on('message', (request: ParseRequest) => {
    readSheet(request.bytes, request.options).then(
      (result) => port.postMessage({ id: request.id, result } satisfies ParseResponse),
      (error: unknown) =>
        port.postMessage({
          id: request.id,
          error: error instanceof Error ? error.message : String(error),
        } satisfies ParseResponse),
    );
  });
}
