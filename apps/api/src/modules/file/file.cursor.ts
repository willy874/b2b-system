import { isCursorTimestamp } from '@/core/http';
import type { SortEntry } from '@/core/http';

export type FileSortField = 'createdAt' | 'name' | 'size';

/**
 * keyset 分頁的游標：上一頁最後一筆（或這一頁第一筆）的「排序值 ＋ id」＋ 方向。
 *
 * 無限捲動用 offset 會在捲動途中有人上傳或刪除時重複或漏掉項目；游標以「排在這一筆之後」取下一頁，
 * 中間插入或刪除都不影響（docs/architecture/backend/09-file.md §6.1）。
 * 排序條件寫進游標：換了排序還拿舊游標是呼叫端的錯誤，回 400 而不是回一頁錯亂的資料。
 * 方向：`after` 取排在這一筆之後的一頁（`nextCursor`）、`before` 取排在它之前的一頁（`prevCursor`）——
 * 前端的無限捲動只保留最近的幾頁（`maxPages`），往回捲時以 `before` 把丟掉的頁抓回來。
 */
export type FileCursorDirection = 'after' | 'before';

export interface FileCursor {
  sort: SortEntry<FileSortField>;
  /**
   * createdAt：**微秒** 精度的 ISO 字串（由資料庫直接格式化；JS 的 Date 只有毫秒，截掉會漏項目）；
   * name：字串；size：數字。
   */
  value: string | number;
  id: string;
  direction: FileCursorDirection;
}

export function encodeFileCursor(cursor: FileCursor): string {
  const payload = [cursor.sort.sort, cursor.sort.order, cursor.value, cursor.id];
  // `after` 不寫方向：與方向出現之前發出的游標相同
  if (cursor.direction === 'before') payload.push('before');
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

const SORT_FIELDS: ReadonlySet<string> = new Set(['createdAt', 'name', 'size']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 排序值是不是 Postgres 一定接受的值：值會直接進 SQL（`::timestamptz`、與 bigint／text 欄位比較），
 * Postgres 拒絕的值會讓請求回 500 而不是 400（docs/architecture/backend/09-file.md §6.1）。
 */
function isValidSortValue(field: FileSortField, value: unknown): value is string | number {
  switch (field) {
    case 'createdAt':
      return isCursorTimestamp(value);
    case 'size':
      // 1.5、1e400（JSON.parse 之後是 Infinity）的型別都是 number，但轉不成 bigint
      return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
    case 'name':
      // Postgres 的 text 存不下 NUL
      return typeof value === 'string' && !value.includes('\u0000');
  }
}

/** 格式不對回 `undefined`（由呼叫端決定錯誤碼）；不信任內容，逐欄檢查型別與值。 */
export function decodeFileCursor(raw: string): FileCursor | undefined {
  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    return undefined;
  }
  if (!Array.isArray(payload) || payload.length < 4 || payload.length > 5) return undefined;
  const [sort, order, value, id, direction = 'after'] = payload as unknown[];
  if (direction !== 'after' && direction !== 'before') return undefined;
  if (typeof sort !== 'string' || !SORT_FIELDS.has(sort)) return undefined;
  if (order !== 'asc' && order !== 'desc') return undefined;
  if (typeof id !== 'string' || !UUID.test(id)) return undefined;
  const field = sort as FileSortField;
  if (!isValidSortValue(field, value)) return undefined;
  return { sort: { sort: field, order }, value, id, direction };
}
