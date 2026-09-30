import { z } from 'zod';

export const NOTIFICATION_FILTERS = ['all', 'unread'] as const;

export const NotificationSearchQuerySchema = z.object({
  /** 全部或只有未讀；分享網址時對方也看到同一個篩選。 */
  filter: z.enum(NOTIFICATION_FILTERS).default('all').catch('all'),
});

export type NotificationSearchQuery = z.infer<typeof NotificationSearchQuerySchema>;

/** 預設的查詢條件；與它相等的參數不寫進網址。 */
export const DEFAULT_NOTIFICATION_SEARCH: NotificationSearchQuery = { filter: 'all' };
