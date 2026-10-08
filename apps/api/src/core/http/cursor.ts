/**
 * encode 時會產生的時間格式：UTC，毫秒（`toISOString()` 的退路）或微秒（資料庫的 `to_char(… 'US')`）。
 * Postgres 沒有西元 0 年。
 */
const CURSOR_TIMESTAMP = /^(?!0000)\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}(\d{3})?Z$/;

/**
 * keyset 游標裡的時間（`created_at`）是不是 Postgres 一定接受的值。
 *
 * V8 的 `Date.parse` 比 Postgres 寬鬆：`2026-02-30` 會進位成 3 月 2 日、`2026`、`0` 都回數字；
 * 只用它檢查的值以 `::timestamptz` 進 SQL 會讓 Postgres 拋錯、整個請求回 500。這裡只接受 encode 時的格式，
 * 並確認日期與時間的每一欄都真的存在（V8 解析後格式化回來要一樣），在進資料庫之前就擋下
 * （docs/architecture/backend/09-file.md §6.1、docs/architecture/backend/15-notification.md §5）。
 */
export function isCursorTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || !CURSOR_TIMESTAMP.test(value)) return false;
  const time = Date.parse(value);
  return !Number.isNaN(time) && new Date(time).toISOString().slice(0, 23) === value.slice(0, 23);
}

/**
 * keyset 分頁的游標：上一頁最後一筆的 `created_at`（**微秒** 精度的 ISO 字串，由資料庫直接格式化；
 * JS 的 Date 只有毫秒，截掉會漏項目）＋ id。新的在前、捲動途中會不斷新增的列表用它（通知、留言）：
 * 游標以「排在這一筆之後」取下一頁，前面插入或刪除都不影響（docs/architecture/backend/15-notification.md §5）。
 */
export interface TimeIdCursor {
  createdAt: string;
  id: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function encodeTimeIdCursor(cursor: TimeIdCursor): string {
  return Buffer.from(JSON.stringify([cursor.createdAt, cursor.id]), 'utf8').toString('base64url');
}

/**
 * 格式不對回 `undefined`（由呼叫端決定錯誤碼）；不信任內容，逐欄檢查型別與值。
 * 時間只接受 encode 時的格式：值會以 `::timestamptz` 進 SQL，Postgres 拒絕的值會讓請求回 500（`isCursorTimestamp`）。
 */
export function decodeTimeIdCursor(raw: string): TimeIdCursor | undefined {
  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    return undefined;
  }
  if (!Array.isArray(payload) || payload.length !== 2) return undefined;
  const [createdAt, id] = payload as unknown[];
  if (!isCursorTimestamp(createdAt)) return undefined;
  if (typeof id !== 'string' || !UUID.test(id)) return undefined;
  return { createdAt, id };
}
