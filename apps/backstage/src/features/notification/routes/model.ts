import { z } from 'zod/mini';

export const NOTIFICATION_FILTERS = ['all', 'unread'] as const;

export const NotificationSearchQuerySchema = z.object({
  /** 全部或只有未讀；分享網址時對方也看到同一個篩選。 */
  filter: z.catch(z._default(z.enum(NOTIFICATION_FILTERS), 'all'), 'all'),
});

export type NotificationSearchQuery = z.infer<typeof NotificationSearchQuerySchema>;

/** 預設的查詢條件；與它相等的參數不寫進網址。 */
export const DEFAULT_NOTIFICATION_SEARCH: NotificationSearchQuery = { filter: 'all' };

/** 通知總覽的篩選（docs/architecture/backend/19-announcement.md §9.2 D1）；日期是使用者當地的日曆日（`YYYY-MM-DD`）。 */
export const NotificationOverviewSearchQuerySchema = z.object({
  type: z.catch(z.optional(z.string().check(z.trim())), undefined),
  recipientId: z.catch(z.optional(z.uuid()), undefined),
  // core/router 的 search 值一律是字串（`?unread=true`）；navigate 時傳布林
  unread: z.catch(
    z.pipe(
      z.transform((value) => value === true || value === 'true' || undefined),
      z.optional(z.literal(true)),
    ),
    undefined,
  ),
  from: z.catch(z.optional(z.string()), undefined),
  to: z.catch(z.optional(z.string()), undefined),
});

export type NotificationOverviewSearchQuery = z.infer<typeof NotificationOverviewSearchQuerySchema>;
