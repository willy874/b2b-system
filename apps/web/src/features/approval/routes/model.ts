import { z } from 'zod';

import type { ApprovalSortField } from '@/apis/approval/types';
import { sortSearchSchema } from '@/shared/constants';

/** 列表可排序的欄位（後端白名單）。 */
export const APPROVAL_SORT_FIELDS = [
  'createdAt',
  'reviewedAt',
] as const satisfies readonly ApprovalSortField[];

export const ApprovalSearchQuerySchema = z.object({
  offset: z.coerce.number().int().min(0).default(0).catch(0),
  limit: z.coerce.number().int().min(1).max(200).default(20).catch(20),
  keyword: z.string().trim().optional().catch(undefined),
  status: z.enum(['pending', 'approved', 'rejected']).optional().catch(undefined),
  type: z.enum(['user.register']).optional().catch(undefined),
  /** 多欄排序（陣列順序即優先順序）；空陣列＝後端預設排序（建立時間新到舊）。 */
  sort: sortSearchSchema(APPROVAL_SORT_FIELDS),
});

export type ApprovalSearchQuery = z.infer<typeof ApprovalSearchQuerySchema>;

/** 預設的查詢條件；與它相等的參數不寫進網址（`stripSearchParams`，見 routes/pages.ts）。 */
export const DEFAULT_APPROVAL_SEARCH: ApprovalSearchQuery = {
  offset: 0,
  limit: 20,
  sort: [],
};
