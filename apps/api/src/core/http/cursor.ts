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
