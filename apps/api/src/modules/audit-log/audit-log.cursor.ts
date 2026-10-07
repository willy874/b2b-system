import { isCursorTimestamp } from '@/core/http';

/**
 * keyset 分頁的游標：上一頁最後一筆的 `occurred_at`（**微秒** 精度的 ISO 字串，由資料庫直接格式化；
 * JS 的 Date 只有毫秒，截掉會漏項目）＋ id（bigint 的十進位字串）。
 *
 * offset 分頁每一頁都要先掃過前面的列，上限 `AUDIT_LOG_MAX_OFFSET` 之後就翻不下去；游標以「排在這一筆之後」取下一頁，
 * 翻多深都只讀一頁，翻頁途中寫入的新紀錄也不會讓下一頁重複（docs/architecture/backend/06-audit-log.md §7）。
 */
export interface AuditLogCursor {
  occurredAt: string;
  id: string;
}

/** 正的 bigint（有號 64 位元）：值會以 `::bigint` 進 SQL。 */
const BIGINT_ID = /^[1-9]\d{0,18}$/;
const MAX_BIGINT = 9_223_372_036_854_775_807n;

export function encodeAuditLogCursor(cursor: AuditLogCursor): string {
  return Buffer.from(JSON.stringify([cursor.occurredAt, cursor.id]), 'utf8').toString('base64url');
}

/** 格式不對回 `undefined`（由呼叫端決定錯誤碼）；不信任內容，逐欄檢查型別與值。 */
export function decodeAuditLogCursor(raw: string): AuditLogCursor | undefined {
  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    return undefined;
  }
  if (!Array.isArray(payload) || payload.length !== 2) return undefined;
  const [occurredAt, id] = payload as unknown[];
  if (!isCursorTimestamp(occurredAt)) return undefined;
  if (typeof id !== 'string' || !BIGINT_ID.test(id) || BigInt(id) > MAX_BIGINT) return undefined;
  return { occurredAt, id };
}
