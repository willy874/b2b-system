import {
  keywordSearchSchema,
  paginationSearchShape,
  sortSearchSchema,
} from '@b2b-system/web-shared/constants';
import { z } from 'zod/mini';

import type { ServiceAccountSortField } from '@/apis/service-account/types';

/** 列表可排序的欄位（後端白名單）。 */
export const SERVICE_ACCOUNT_SORT_FIELDS = [
  'createdAt',
  'name',
] as const satisfies readonly ServiceAccountSortField[];

/** `.catch()` 而非 `.default()`：使用者手改網址成 ?limit=abc 時退回預設值，不變成錯誤頁。 */
export const ServiceAccountSearchQuerySchema = z.object({
  ...paginationSearchShape(),
  keyword: keywordSearchSchema,
  sort: sortSearchSchema(SERVICE_ACCOUNT_SORT_FIELDS),
});

export type ServiceAccountSearchQuery = z.infer<typeof ServiceAccountSearchQuerySchema>;

/** 預設的查詢條件；與它相等的參數不寫進網址（`stripSearchParams`，見 routes/pages.ts）。 */
export const DEFAULT_SERVICE_ACCOUNT_SEARCH: ServiceAccountSearchQuery = {
  offset: 0,
  limit: 20,
  sort: [],
};
