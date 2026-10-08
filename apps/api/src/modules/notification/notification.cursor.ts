import { decodeTimeIdCursor, encodeTimeIdCursor } from '@/core/http';
import type { TimeIdCursor } from '@/core/http';

/**
 * 通知列表的 keyset 游標（docs/architecture/backend/15-notification.md §5）：通知會在捲動途中不斷新增（新的在最前面），
 * offset 分頁會讓下一頁重複前一頁的最後幾筆。編碼與驗證是通用的 `core/http` 的 `TimeIdCursor`（留言列表也用）。
 */
export type NotificationCursor = TimeIdCursor;

export const encodeNotificationCursor = encodeTimeIdCursor;

export const decodeNotificationCursor = decodeTimeIdCursor;
