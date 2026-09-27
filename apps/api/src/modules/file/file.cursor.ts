import type { SortEntry } from '@/core/http';

export type FileSortField = 'createdAt' | 'name' | 'size';

/**
 * keyset 分頁的游標：上一頁最後一筆的「排序值 ＋ id」。
 *
 * 無限捲動用 offset 會在捲動途中有人上傳或刪除時重複或漏掉項目；游標以「排在這一筆之後」取下一頁，
 * 中間插入或刪除都不影響（docs/architecture/backend/09-file.md §6.1）。
 * 排序條件寫進游標：換了排序還拿舊游標是呼叫端的錯誤，回 400 而不是回一頁錯亂的資料。
 */
export interface FileCursor {
  sort: SortEntry<FileSortField>;
  /**
   * createdAt：**微秒** 精度的 ISO 字串（由資料庫直接格式化；JS 的 Date 只有毫秒，截掉會漏項目）；
   * name：字串；size：數字。
   */
  value: string | number;
  id: string;
}

export function encodeFileCursor(cursor: FileCursor): string {
  const payload = [cursor.sort.sort, cursor.sort.order, cursor.value, cursor.id];
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

const SORT_FIELDS: ReadonlySet<string> = new Set(['createdAt', 'name', 'size']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 格式不對回 `undefined`（由呼叫端決定錯誤碼）；不信任內容，逐欄檢查型別。 */
export function decodeFileCursor(raw: string): FileCursor | undefined {
  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    return undefined;
  }
  if (!Array.isArray(payload) || payload.length !== 4) return undefined;
  const [sort, order, value, id] = payload as unknown[];
  if (typeof sort !== 'string' || !SORT_FIELDS.has(sort)) return undefined;
  if (order !== 'asc' && order !== 'desc') return undefined;
  if (typeof id !== 'string' || !UUID.test(id)) return undefined;
  const field = sort as FileSortField;
  if (field === 'size' ? typeof value !== 'number' : typeof value !== 'string') return undefined;
  if (field === 'createdAt' && Number.isNaN(Date.parse(value as string))) return undefined;
  return { sort: { sort: field, order }, value: value as string | number, id };
}
