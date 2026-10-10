import { sortSearchSchema } from '@b2b-system/web-shared/constants';
import { z } from 'zod/mini';

import type { GroupSortField } from '@/apis/group/types';

/** 列表可排序的欄位（後端白名單）。 */
export const GROUP_SORT_FIELDS = [
  'createdAt',
  'name',
  'memberCount',
  'roleCount',
] as const satisfies readonly GroupSortField[];

/** `.catch()` 而非 `.default()`：使用者手改網址成 ?limit=abc 時退回預設值，不變成錯誤頁。 */
export const GroupSearchQuerySchema = z.object({
  offset: z.catch(z.coerce.number().check(z.int(), z.minimum(0)), 0),
  limit: z.catch(z.coerce.number().check(z.int(), z.minimum(1), z.maximum(200)), 20),
  keyword: z.catch(z.optional(z.string().check(z.trim())), undefined),
  sort: sortSearchSchema(GROUP_SORT_FIELDS),
});

export type GroupSearchQuery = z.infer<typeof GroupSearchQuerySchema>;

/** 預設的查詢條件；與它相等的參數不寫進網址（`stripSearchParams`，見 routes/pages.ts）。 */
export const DEFAULT_GROUP_SEARCH: GroupSearchQuery = { offset: 0, limit: 20, sort: [] };
