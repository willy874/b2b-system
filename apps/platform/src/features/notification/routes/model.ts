import { paginationSearchShape } from '@b2b-system/web-shared/constants';
import { z } from 'zod/mini';

export const NOTIFICATION_FILTERS = ['all', 'unread'] as const;

export const NotificationSearchQuerySchema = z.object({
  filter: z.catch(z.enum(NOTIFICATION_FILTERS), 'all'),
  ...paginationSearchShape(20, 100),
});

export type NotificationSearchQuery = z.infer<typeof NotificationSearchQuerySchema>;

/** 與它相等的參數不寫進網址（`stripSearchParams`）。 */
export const DEFAULT_NOTIFICATION_SEARCH: NotificationSearchQuery = {
  filter: 'all',
  offset: 0,
  limit: 20,
};
