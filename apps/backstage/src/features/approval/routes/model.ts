import { sortSearchSchema } from '@b2b-system/web-shared/constants';
import { z } from 'zod/mini';

import type { ApprovalSortField } from '@/apis/approval/types';

import { APPROVAL_LIST_STATUSES, APPROVAL_TYPES, MY_APPROVAL_TABS } from '../constants';

/** 列表可排序的欄位（後端白名單）。 */
export const APPROVAL_SORT_FIELDS = [
  'createdAt',
  'reviewedAt',
] as const satisfies readonly ApprovalSortField[];

export const ApprovalSearchQuerySchema = z.object({
  offset: z.catch(z._default(z.coerce.number().check(z.int(), z.minimum(0)), 0), 0),
  limit: z.catch(
    z._default(z.coerce.number().check(z.int(), z.minimum(1), z.maximum(200)), 20),
    20,
  ),
  keyword: z.catch(z.optional(z.string().check(z.trim())), undefined),
  /**
   * 狀態的分段切換；預設只看待審（docs/architecture/backend/20-approval.md §11.2）。「全部」是明確的 `all`：
   * 省略時是預設的待審，不能同時代表「全部」。
   */
  status: z.catch(z._default(z.enum(APPROVAL_LIST_STATUSES), 'pending'), 'pending'),
  type: z.catch(z.optional(z.enum(APPROVAL_TYPES)), undefined),
  /** 多欄排序（陣列順序即優先順序）；空陣列＝後端預設排序（建立時間新到舊）。 */
  sort: sortSearchSchema(APPROVAL_SORT_FIELDS),
});

export type ApprovalSearchQuery = z.infer<typeof ApprovalSearchQuerySchema>;

/** 預設的查詢條件；與它相等的參數不寫進網址（`stripSearchParams`，見 routes/pages.ts）。 */
export const DEFAULT_APPROVAL_SEARCH: ApprovalSearchQuery = {
  offset: 0,
  limit: 20,
  status: 'pending',
  sort: [],
};

/**
 * 詳情帶著列表的條件：「回到列表」回到同樣的篩選；`queue` 是從待審清單點進來的（決定後前往下一筆，§12 D5）。
 * 從通知或網址直接進來的沒有 `queue`，決定後留在原頁。
 */
// 網址的值一律是字串（web-core/router/search.ts），程式內導覽時是 true：兩者都收
const QueueSchema = z.catch(
  // optional：沒帶時這個鍵可以省略（導覽時不必給）
  z.optional(
    z.pipe(
      z.transform((value) => (value === true || value === 'true' ? true : undefined)),
      z.optional(z.literal(true)),
    ),
  ),
  undefined,
);

export const ApprovalDetailSearchSchema = z.extend(ApprovalSearchQuerySchema, {
  queue: QueueSchema,
});
export type ApprovalDetailSearch = z.infer<typeof ApprovalDetailSearchSchema>;

/** 「我的審批」（docs/architecture/backend/20-approval.md §9.10）：分頁與分頁的頁碼。 */
export const MyApprovalSearchQuerySchema = z.object({
  tab: z.catch(z.optional(z.enum(MY_APPROVAL_TABS)), undefined),
  offset: z.catch(z._default(z.coerce.number().check(z.int(), z.minimum(0)), 0), 0),
  limit: z.catch(
    z._default(z.coerce.number().check(z.int(), z.minimum(1), z.maximum(200)), 20),
    20,
  ),
});

export type MyApprovalSearchQuery = z.infer<typeof MyApprovalSearchQuerySchema>;

export const DEFAULT_MY_APPROVAL_SEARCH: MyApprovalSearchQuery = { offset: 0, limit: 20 };

export const MyApprovalDetailSearchSchema = z.extend(MyApprovalSearchQuerySchema, {
  queue: QueueSchema,
});
export type MyApprovalDetailSearch = z.infer<typeof MyApprovalDetailSearchSchema>;
