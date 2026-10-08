import { MULTI_VALUE_SEPARATOR, NULL_TOKEN } from './data-transfer.constants';
import type { TransferColumn, TransferEnumOption, TransferLocale } from './data-transfer.types';

/**
 * 值的格式（雙向，docs/architecture/backend/22-data-transfer.md §5.3）。匯出的 CSV、修改模式的「目前值」、結果報告
 * 都用同一個文字表示（`toCellText`），所以「匯出 → 修改 → 匯回」時沒改的儲存格會被判斷為沒有變更。
 */

const BOOLEAN_LABEL: Readonly<Record<TransferLocale, readonly [string, string]>> = {
  'zh-TW': ['是', '否'],
  'en-US': ['Yes', 'No'],
};
const TRUE_WORDS = new Set(['true', '1', 'yes', 'y', '是']);
const FALSE_WORDS = new Set(['false', '0', 'no', 'n', '否']);
for (const [yes, no] of Object.values(BOOLEAN_LABEL)) {
  TRUE_WORDS.add(yes.toLowerCase());
  FALSE_WORDS.add(no.toLowerCase());
}

/** 公式注入：CSV 的字串開頭是這些字元時前置 `'`；匯入時去掉（§6.5、D16）。 */
const FORMULA_START = /^[=+\-@\t\r]/;

// ── 時區 ──

function offsetMinutes(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  const wall = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  return Math.round((wall - Math.floor(instant.getTime() / 1000) * 1000) / 60_000);
}

function pad(value: number, length = 2): string {
  return String(value).padStart(length, '0');
}

/** 這個時刻在 `timeZone` 的牆上時間（以 UTC 欄位表示的 Date）。 */
export function wallClock(instant: Date, timeZone: string): Date {
  return new Date(instant.getTime() + offsetMinutes(instant, timeZone) * 60_000);
}

/** `2026-10-08T14:30:00+08:00`：以 `timeZone` 的牆上時間加上時差。 */
export function formatZonedDateTime(instant: Date, timeZone: string): string {
  const offset = offsetMinutes(instant, timeZone);
  const wall = new Date(instant.getTime() + offset * 60_000);
  const sign = offset < 0 ? '-' : '+';
  const abs = Math.abs(offset);
  return (
    `${wall.getUTCFullYear()}-${pad(wall.getUTCMonth() + 1)}-${pad(wall.getUTCDate())}` +
    `T${pad(wall.getUTCHours())}:${pad(wall.getUTCMinutes())}:${pad(wall.getUTCSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

/** 檔名用的 `YYYYMMDD-HHmm`（匯出者的時區）。 */
export function fileTimestamp(instant: Date, timeZone: string): string {
  const wall = wallClock(instant, timeZone);
  return (
    `${wall.getUTCFullYear()}${pad(wall.getUTCMonth() + 1)}${pad(wall.getUTCDate())}` +
    `-${pad(wall.getUTCHours())}${pad(wall.getUTCMinutes())}`
  );
}

/** 沒有時差的牆上時間（年月日時分秒）在 `timeZone` 的時刻；兩次校正處理日光節約的邊界。 */
export function zonedWallTimeToInstant(
  parts: readonly [number, number, number, number, number, number],
  timeZone: string,
): Date {
  const [year, month, day, hour, minute, second] = parts;
  const guess = Date.UTC(year, month - 1, day, hour, minute, second);
  let instant = guess - offsetMinutes(new Date(guess), timeZone) * 60_000;
  instant = guess - offsetMinutes(new Date(instant), timeZone) * 60_000;
  return new Date(instant);
}

function toDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'string' || typeof value === 'number') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

// ── 匯出：值 → 文字 ──

export interface FormatContext {
  locale: TransferLocale;
  timezone: string;
}

function enumLabel(
  options: readonly TransferEnumOption[] | undefined,
  value: string,
  locale: TransferLocale,
) {
  return options?.find((option) => option.value === value)?.label[locale] ?? value;
}

function scalarText(column: TransferColumn<unknown>, value: unknown, ctx: FormatContext): string {
  if (value === null || value === undefined) return '';
  switch (column.kind) {
    case 'boolean': {
      const [yes, no] = BOOLEAN_LABEL[ctx.locale];
      return value ? yes : no;
    }
    case 'date': {
      if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
      const date = toDate(value);
      return date ? formatZonedDateTime(date, ctx.timezone).slice(0, 10) : '';
    }
    case 'datetime': {
      const date = toDate(value);
      return date ? formatZonedDateTime(date, ctx.timezone) : '';
    }
    case 'enum':
      return enumLabel(column.enum, String(value), ctx.locale);
    case 'json':
      return JSON.stringify(value);
    default:
      return String(value);
  }
}

/** 文字表示：CSV 的儲存格、修改模式的目前值、結果報告。多值以 `;` 串接。 */
export function toCellText(
  column: TransferColumn<unknown>,
  value: unknown,
  ctx: FormatContext,
): string {
  if (Array.isArray(value)) {
    return value.map((item) => scalarText(column, item, ctx)).join(MULTI_VALUE_SEPARATOR);
  }
  return scalarText(column, value, ctx);
}

/** CSV 用：文字類的值開頭是公式字元時前置 `'`（數字、日期不加，負數照常是 `-5`）。 */
export function escapeFormula(column: TransferColumn<unknown>, text: string): string {
  if (column.kind === 'number' || column.kind === 'date' || column.kind === 'datetime') return text;
  return FORMULA_START.test(text) ? `'${text}` : text;
}

/** XLSX 用：數字、日期、日期時間寫成對應型別的儲存格；日期時間以匯出者時區的牆上時間呈現。 */
export function toXlsxValue(
  column: TransferColumn<unknown>,
  value: unknown,
  ctx: FormatContext,
): string | number | Date | null {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return toCellText(column, value, ctx);
  if (column.kind === 'number' && typeof value === 'number') return value;
  if (column.kind === 'date') {
    const text = scalarText(column, value, ctx);
    return text ? new Date(`${text}T00:00:00Z`) : null;
  }
  if (column.kind === 'datetime') {
    const date = toDate(value);
    return date ? wallClock(date, ctx.timezone) : null;
  }
  return scalarText(column, value, ctx);
}

function dataScalar(column: TransferColumn<unknown>, value: unknown, ctx: FormatContext): unknown {
  if (value === null || value === undefined) return null;
  switch (column.kind) {
    case 'number':
      return typeof value === 'number' && Number.isFinite(value) ? value : String(value);
    case 'boolean':
      return Boolean(value);
    case 'date':
    case 'datetime':
      return scalarText(column, value, ctx) || null;
    case 'json':
      return value;
    // enum 輸出值代碼（與 SQL 相同；匯入時代碼、任一語系的標籤都認得）
    default:
      return String(value);
  }
}

/**
 * JSON／YAML 用（§6.5）：保留型別的值。數字、是否是原生型別，多值是陣列，空值是 `null`，enum 是值代碼；
 * 日期與日期時間的文字與 CSV 相同（日期時間帶匯出者時區的時差）。匯入時讀檔器把這些值轉回儲存格文字。
 */
export function toDataValue(
  column: TransferColumn<unknown>,
  value: unknown,
  ctx: FormatContext,
): unknown {
  if (column.multiple) {
    if (value === null || value === undefined) return [];
    return (Array.isArray(value) ? value : [value]).map((item) => dataScalar(column, item, ctx));
  }
  return dataScalar(column, value, ctx);
}

/** SQL 的欄位型別（§6.5）。 */
export function sqlType(column: TransferColumn<unknown>): string {
  const base = {
    string: 'text',
    number: 'numeric',
    boolean: 'boolean',
    date: 'date',
    datetime: 'timestamptz',
    enum: 'text',
    reference: 'text',
    json: 'jsonb',
  }[column.kind];
  return column.multiple ? `${base}[]` : base;
}

function sqlString(text: string): string {
  return `'${text.replaceAll("'", "''")}'`;
}

function sqlScalar(column: TransferColumn<unknown>, value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  switch (column.kind) {
    case 'number':
      return typeof value === 'number' && Number.isFinite(value) ? String(value) : 'NULL';
    case 'boolean':
      return value ? 'TRUE' : 'FALSE';
    case 'date': {
      if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return sqlString(value);
      const date = toDate(value);
      return date ? sqlString(date.toISOString().slice(0, 10)) : 'NULL';
    }
    case 'datetime': {
      const date = toDate(value);
      return date ? sqlString(date.toISOString()) : 'NULL';
    }
    case 'json':
      return sqlString(JSON.stringify(value));
    // enum 輸出值代碼（不是標籤）
    default:
      return sqlString(String(value));
  }
}

/** SQL 的值：`standard_conforming_strings = on` 的寫法，不用 `E''`。 */
export function toSqlLiteral(column: TransferColumn<unknown>, value: unknown): string {
  if (column.multiple) {
    if (value === null || value === undefined) return 'NULL';
    const items = Array.isArray(value) ? value : [value];
    if (items.length === 0) return `'{}'::${sqlType(column)}`;
    return `ARRAY[${items.map((item) => sqlScalar(column, item)).join(', ')}]`;
  }
  return sqlScalar(column, value);
}

/** `displayName` → `display_name`。 */
export function snakeCase(key: string): string {
  return key.replaceAll(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}

// ── 匯入：文字 → 值 ──

/** 標頭與選項比對前的正規化：去空白、小寫、全形轉半形、壓縮空白。 */
export function normalizeText(text: string): string {
  return text.normalize('NFKC').trim().replaceAll(/\s+/g, ' ').toLowerCase();
}

export type ParsedCell =
  /** 空白（新增模式：沒填；修改模式：不變更） */
  | { kind: 'empty' }
  /** `\N`：清空 */
  | { kind: 'null' }
  | { kind: 'value'; value: unknown }
  | { kind: 'issue'; code: string; params?: Record<string, unknown> };

/** 去頭尾空白；開頭的 `'` 後面接公式字元時去掉這個 `'`（D16），來回不變形。 */
export function cleanText(raw: string): string {
  const text = raw.trim();
  return text.startsWith("'") && FORMULA_START.test(text.slice(1)) ? text.slice(1) : text;
}

const DECIMAL = /^[+-]?(\d+(\.\d*)?|\.\d+)$/;
const DATE_PATTERN = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/;
const DATETIME_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/i;

function parseDate(text: string): string | null {
  const match = DATE_PATTERN.exec(text);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  // 拒絕不存在的日期（02-30）
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return `${year}-${pad(month)}-${pad(day)}`;
}

function parseDateTime(text: string, timezone: string): Date | null {
  const match = DATETIME_PATTERN.exec(text);
  if (!match) return null;
  const parts = [1, 2, 3, 4, 5, 6].map((index) => Number(match[index] ?? 0)) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  if (
    !parseDate(`${parts[0]}-${parts[1]}-${parts[2]}`) ||
    parts[3] > 23 ||
    parts[4] > 59 ||
    parts[5] > 59
  ) {
    return null;
  }
  // 有時差就照它；沒有時差以建立這次匯入的人的時區解讀（§5.3）
  if (match[7]) {
    const date = new Date(text.replace(' ', 'T'));
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return zonedWallTimeToInstant(parts, timezone);
}

function enumValue(column: TransferColumn<unknown>, text: string): string | null {
  const wanted = normalizeText(text);
  for (const option of column.enum ?? []) {
    const candidates = [option.value, ...Object.values(option.label), ...(option.aliases ?? [])];
    if (candidates.some((candidate) => normalizeText(candidate) === wanted)) return option.value;
  }
  return null;
}

/** 編輯距離：只用來附上「最接近的候選」（D7：不自動更正）。 */
export function editDistance(a: string, b: string): number {
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = previous[0] ?? 0;
    previous[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const above = previous[j] ?? 0;
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      previous[j] = Math.min(above + 1, (previous[j - 1] ?? 0) + 1, diagonal + cost);
      diagonal = above;
    }
  }
  return previous[b.length] ?? 0;
}

/** 最接近的候選；差太多（超過長度的三分之一，至少 2）就不建議。 */
export function closest(text: string, candidates: readonly string[]): string | null {
  const wanted = normalizeText(text);
  let best: { candidate: string; distance: number } | null = null;
  for (const candidate of candidates) {
    const distance = editDistance(wanted, normalizeText(candidate));
    if (!best || distance < best.distance) best = { candidate, distance };
  }
  if (!best) return null;
  return best.distance <= Math.max(2, Math.floor(wanted.length / 3)) ? best.candidate : null;
}

function parseScalar(
  column: TransferColumn<unknown>,
  text: string,
  ctx: FormatContext,
): ParsedCell {
  switch (column.kind) {
    case 'number':
      return DECIMAL.test(text)
        ? { kind: 'value', value: Number(text) }
        : { kind: 'issue', code: 'invalidNumber' };
    case 'boolean': {
      const word = normalizeText(text);
      if (TRUE_WORDS.has(word)) return { kind: 'value', value: true };
      if (FALSE_WORDS.has(word)) return { kind: 'value', value: false };
      return { kind: 'issue', code: 'invalidBoolean' };
    }
    case 'date': {
      const date = parseDate(text);
      return date ? { kind: 'value', value: date } : { kind: 'issue', code: 'invalidDate' };
    }
    case 'datetime': {
      const date = parseDateTime(text, ctx.timezone);
      return date ? { kind: 'value', value: date } : { kind: 'issue', code: 'invalidDateTime' };
    }
    case 'enum': {
      const value = enumValue(column, text);
      if (value !== null) return { kind: 'value', value };
      const labels = (column.enum ?? []).map((option) => option.label[ctx.locale]);
      const suggestion = closest(text, labels);
      return {
        kind: 'issue',
        code: 'invalidEnum',
        params: { value: text, options: labels, ...(suggestion ? { suggestion } : {}) },
      };
    }
    default:
      return { kind: 'value', value: cleanText(text) };
  }
}

/**
 * 一格原始字串 → 值。`reference` 回傳名稱（陣列或單一字串），由驗證器批次解析成 id。
 * 欄位的 `schema` 不在這裡跑：驗證器把轉換後的值交給 schema，並把 Zod 的 issue 對應成問題代碼。
 */
export function parseCell(
  column: TransferColumn<unknown>,
  raw: string,
  ctx: FormatContext,
): ParsedCell {
  const text = raw.trim();
  if (text === '') return { kind: 'empty' };
  if (text === NULL_TOKEN) return { kind: 'null' };
  if (!column.multiple) return parseScalar(column, cleanText(text), ctx);
  // 先去重再檢查上限：同一個值寫兩次不算兩個
  const items = [
    ...new Set(
      text
        .split(MULTI_VALUE_SEPARATOR)
        .map((item) => cleanText(item))
        .filter((item) => item !== ''),
    ),
  ];
  if (column.multiple.max !== undefined && items.length > column.multiple.max) {
    return { kind: 'issue', code: 'tooManyValues', params: { max: column.multiple.max } };
  }
  const values: unknown[] = [];
  for (const item of items) {
    const parsed = parseScalar(column, item, ctx);
    if (parsed.kind === 'issue') return parsed;
    if (parsed.kind === 'value') values.push(parsed.value);
  }
  return { kind: 'value', value: values };
}
