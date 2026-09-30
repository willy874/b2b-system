/**
 * keyset 分頁的游標：上一頁最後一筆的 `created_at`（**微秒** 精度的 ISO 字串，由資料庫直接格式化；
 * JS 的 Date 只有毫秒，截掉會漏項目）＋ id。
 *
 * 通知會在捲動途中不斷新增（新的在最前面），offset 分頁會讓下一頁重複前一頁的最後幾筆；
 * 游標以「排在這一筆之後」取下一頁，前面插入或刪除都不影響（docs/architecture/backend/15-notification.md §5）。
 */
export interface NotificationCursor {
  createdAt: string;
  id: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function encodeNotificationCursor(cursor: NotificationCursor): string {
  return Buffer.from(JSON.stringify([cursor.createdAt, cursor.id]), 'utf8').toString('base64url');
}

/** 格式不對回 `undefined`（由呼叫端決定錯誤碼）；不信任內容，逐欄檢查型別。 */
export function decodeNotificationCursor(raw: string): NotificationCursor | undefined {
  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    return undefined;
  }
  if (!Array.isArray(payload) || payload.length !== 2) return undefined;
  const [createdAt, id] = payload as unknown[];
  if (typeof createdAt !== 'string' || Number.isNaN(Date.parse(createdAt))) return undefined;
  if (typeof id !== 'string' || !UUID.test(id)) return undefined;
  return { createdAt, id };
}
