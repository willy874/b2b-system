import { z } from 'zod';

import type { RoleSortField } from '@/apis/role/types';
import { sortSearchSchema } from '@/shared/constants';
import type { SortEntry } from '@/shared/constants';

/** 列表可排序的欄位（後端白名單）。 */
export const ROLE_SORT_FIELDS = [
  'createdAt',
  'name',
  'slug',
] as const satisfies readonly RoleSortField[];

export const DEFAULT_ROLE_SORT: Array<SortEntry<RoleSortField>> = [
  { sort: 'createdAt', order: 'desc' },
];

/** `.catch()` 而非 `.default()`：使用者手改網址成 ?limit=abc 時退回預設值，不變成錯誤頁。 */
export const RoleSearchQuerySchema = z.object({
  offset: z.coerce.number().int().min(0).catch(0),
  limit: z.coerce.number().int().min(1).max(200).catch(20),
  keyword: z.string().trim().optional().catch(undefined),
  /** 多欄排序（陣列順序即優先順序）；表頭點擊會換成單一排序，篩選面板可以設定多個。 */
  sort: sortSearchSchema(ROLE_SORT_FIELDS, DEFAULT_ROLE_SORT),
});

export type RoleSearchQuery = z.infer<typeof RoleSearchQuerySchema>;

export const DEFAULT_ROLE_SEARCH: RoleSearchQuery = {
  offset: 0,
  limit: 20,
  sort: DEFAULT_ROLE_SORT,
};
