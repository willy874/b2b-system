import { isCursorTimestamp } from '@/core/http';

export const GALLERY_SORT_FIELDS = ['sortAt', 'createdAt', 'title'] as const;
export type GallerySortField = (typeof GALLERY_SORT_FIELDS)[number];
export type GallerySortOrder = 'asc' | 'desc';

/**
 * keyset 分頁的游標（docs/architecture/backend/26-gallery.md §6）：上一頁最後一筆的「排序值 ＋ id」。
 * 捲動途中有人新增或刪除也不重複、不漏（同檔案的游標，docs/architecture/backend/09-file.md §6.1）。
 * 排序寫進游標：換了排序還拿舊游標回 400，而不是一頁錯亂的資料。
 */
export interface GalleryCursor {
  sort: GallerySortField;
  order: GallerySortOrder;
  /** 時間是 **微秒** 精度的 ISO 字串（資料庫直接格式化）；標題是字串。 */
  value: string;
  id: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function encodeGalleryCursor(cursor: GalleryCursor): string {
  return Buffer.from(
    JSON.stringify([cursor.sort, cursor.order, cursor.value, cursor.id]),
    'utf8',
  ).toString('base64url');
}

/** 格式不對回 `undefined`（由呼叫端回 400）；值會直接進 SQL，逐欄檢查型別與值。 */
export function decodeGalleryCursor(raw: string): GalleryCursor | undefined {
  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    return undefined;
  }
  if (!Array.isArray(payload) || payload.length !== 4) return undefined;
  const [sort, order, value, id] = payload as unknown[];
  if (!(GALLERY_SORT_FIELDS as readonly unknown[]).includes(sort)) return undefined;
  if (order !== 'asc' && order !== 'desc') return undefined;
  if (typeof id !== 'string' || !UUID.test(id)) return undefined;
  const field = sort as GallerySortField;
  if (field === 'title') {
    // Postgres 的 text 存不下 NUL
    if (typeof value !== 'string' || value.includes('\u0000')) return undefined;
  } else if (!isCursorTimestamp(value)) {
    return undefined;
  }
  return { sort: field, order, value: value as string, id };
}
