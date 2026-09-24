import { z } from 'zod';

import type { UserSortField } from '@/apis/user/types';
import { sortSearchSchema } from '@/shared/constants';
import type { SortEntry } from '@/shared/constants';

/** 列表可排序的欄位（後端白名單）。 */
export const USER_SORT_FIELDS = [
  'createdAt',
  'email',
  'displayName',
  'lastLoginAt',
] as const satisfies readonly UserSortField[];

export const DEFAULT_USER_SORT: Array<SortEntry<UserSortField>> = [
  { sort: 'createdAt', order: 'desc' },
];

export const UserSearchQuerySchema = z.object({
  offset: z.coerce.number().int().min(0).default(0).catch(0),
  limit: z.coerce.number().int().min(1).max(200).default(20).catch(20),
  keyword: z.string().trim().optional().catch(undefined),
  status: z.enum(['pending', 'active', 'inactive', 'locked']).optional().catch(undefined),
  /** 多欄排序（陣列順序即優先順序）；表頭點擊會換成單一排序，篩選面板可以設定多個。 */
  sort: sortSearchSchema(USER_SORT_FIELDS, DEFAULT_USER_SORT),
});

export type UserSearchQuery = z.infer<typeof UserSearchQuerySchema>;
