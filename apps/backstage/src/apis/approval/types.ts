import type { SortEntry } from '@b2b-system/web-shared/constants';

import type { ApprovalStatus, ApprovalType } from '@/shared/api-sdk';

/** 後端 `ListApprovalSchema` 的排序白名單。 */
export type ApprovalSortField = 'createdAt' | 'reviewedAt';

/** `all`：全部（`approval:read`）；`assigned`：待我審核；`mine`：我送出的（docs/architecture/backend/20-approval.md §9.13）。 */
export type ApprovalListScope = 'all' | 'assigned' | 'mine';

export interface ApprovalListParams {
  scope?: ApprovalListScope;
  offset: number;
  limit: number;
  /** 申請人名稱（註冊 = email）的部分比對。 */
  keyword?: string;
  status?: ApprovalStatus[];
  type?: ApprovalType[];
  /** 多欄排序，陣列順序即優先順序。 */
  sort?: Array<SortEntry<ApprovalSortField>>;
}
