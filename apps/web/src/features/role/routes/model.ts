import { z } from 'zod';

import type { RoleSortField } from '@/apis/role/types';
import { sortSearchSchema } from '@/shared/constants';

/** 列表可排序的欄位（後端白名單）。 */
export const ROLE_SORT_FIELDS = [
  'createdAt',
  'name',
  'slug',
] as const satisfies readonly RoleSortField[];

/** `.catch()` 而非 `.default()`：使用者手改網址成 ?limit=abc 時退回預設值，不變成錯誤頁。 */
export const RoleSearchQuerySchema = z.object({
  offset: z.coerce.number().int().min(0).catch(0),
  limit: z.coerce.number().int().min(1).max(200).catch(20),
  keyword: z.string().trim().optional().catch(undefined),
  /** 多欄排序（陣列順序即優先順序），表頭與篩選面板都能設定；空陣列＝後端預設排序。 */
  sort: sortSearchSchema(ROLE_SORT_FIELDS),
});

export type RoleSearchQuery = z.infer<typeof RoleSearchQuerySchema>;

/** 預設的查詢條件；與它相等的參數不寫進網址（`stripSearchParams`，見 routes/pages.ts）。 */
export const DEFAULT_ROLE_SEARCH: RoleSearchQuery = {
  offset: 0,
  limit: 20,
  sort: [],
};
