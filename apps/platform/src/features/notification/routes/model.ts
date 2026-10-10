import { z } from 'zod/mini';

export const NOTIFICATION_FILTERS = ['all', 'unread'] as const;

export const NotificationSearchQuerySchema = z.object({
  filter: z.catch(z.enum(NOTIFICATION_FILTERS), 'all'),
  offset: z.catch(z.coerce.number().check(z.int(), z.minimum(0)), 0),
  limit: z.catch(z.coerce.number().check(z.int(), z.minimum(1), z.maximum(100)), 20),
});

export type NotificationSearchQuery = z.infer<typeof NotificationSearchQuerySchema>;

/** 與它相等的參數不寫進網址（`stripSearchParams`）。 */
export const DEFAULT_NOTIFICATION_SEARCH: NotificationSearchQuery = {
  filter: 'all',
  offset: 0,
  limit: 20,
};
