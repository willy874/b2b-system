import { z } from 'zod';

export const NOTIFICATION_FILTERS = ['all', 'unread'] as const;

export const NotificationSearchQuerySchema = z.object({
  filter: z.enum(NOTIFICATION_FILTERS).catch('all'),
  offset: z.coerce.number().int().min(0).catch(0),
  limit: z.coerce.number().int().min(1).max(100).catch(20),
});

export type NotificationSearchQuery = z.infer<typeof NotificationSearchQuerySchema>;

/** 與它相等的參數不寫進網址（`stripSearchParams`）。 */
export const DEFAULT_NOTIFICATION_SEARCH: NotificationSearchQuery = {
  filter: 'all',
  offset: 0,
  limit: 20,
};
