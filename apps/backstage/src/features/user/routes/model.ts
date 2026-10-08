import { sortSearchSchema } from '@b2b-system/web-shared/constants';
import { z } from 'zod';

import type { UserSortField } from '@/apis/user/types';

/** 列表可排序的欄位（後端白名單）。 */
export const USER_SORT_FIELDS = [
  'createdAt',
  'email',
  'displayName',
  'lastLoginAt',
] as const satisfies readonly UserSortField[];

export const UserSearchQuerySchema = z.object({
  offset: z.coerce.number().int().min(0).default(0).catch(0),
  limit: z.coerce.number().int().min(1).max(200).default(20).catch(20),
  keyword: z.string().trim().optional().catch(undefined),
  status: z.enum(['pending', 'active', 'inactive', 'locked']).optional().catch(undefined),
  /** 有沒有設定 MFA（找出不符合政策的人，docs/architecture/backend/21-mfa.md §6）。 */
  mfa: z.enum(['true', 'false']).optional().catch(undefined),
  /** 貼了其中任一個標籤（docs/architecture/backend/18-tag.md §7.2 D6）；網址上重複的 `tagId` 成為陣列（`web-core/router/search.ts`）。 */
  tagId: z
    .union([z.string().uuid(), z.array(z.string().uuid()).min(1)])
    .transform((value) => (Array.isArray(value) ? value : [value]))
    .optional()
    .catch(undefined),
  /** 屬於這個部門（docs/architecture/backend/23-organization.md §8）；租戶沒有啟用 `organization` 時頁面不帶給後端。 */
  orgUnitId: z.string().uuid().optional().catch(undefined),
  /** 部門篩選含下層部門；只在有 `orgUnitId` 時有意義。 */
  includeDescendants: z.enum(['true']).optional().catch(undefined),
  /** 多欄排序（陣列順序即優先順序），表頭與篩選面板都能設定；空陣列＝後端預設排序。 */
  sort: sortSearchSchema(USER_SORT_FIELDS),
});

export type UserSearchQuery = z.infer<typeof UserSearchQuerySchema>;

/** 預設的查詢條件；與它相等的參數不寫進網址（`stripSearchParams`，見 routes/pages.ts）。 */
export const DEFAULT_USER_SEARCH: UserSearchQuery = {
  offset: 0,
  limit: 20,
  sort: [],
};
