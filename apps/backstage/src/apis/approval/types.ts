import type { ApprovalStatus, ApprovalType } from '@/shared/api-sdk';
import type { SortEntry } from '@/shared/constants';

/** 後端 `ListApprovalSchema` 的排序白名單。 */
export type ApprovalSortField = 'createdAt' | 'reviewedAt';

export interface ApprovalListParams {
  offset: number;
  limit: number;
  /** 申請人名稱（註冊 = email）的部分比對。 */
  keyword?: string;
  status?: ApprovalStatus[];
  type?: ApprovalType[];
  /** 多欄排序，陣列順序即優先順序。 */
  sort?: Array<SortEntry<ApprovalSortField>>;
}
