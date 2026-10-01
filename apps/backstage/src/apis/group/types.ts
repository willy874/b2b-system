import type { SortEntry } from '@/shared/constants';

/** 後端 `ListGroupSchema` 的排序白名單。 */
export type GroupSortField = 'createdAt' | 'name' | 'memberCount' | 'roleCount';

export interface GroupListParams {
  offset: number;
  limit: number;
  keyword?: string;
  /** 多欄排序，陣列順序即優先順序。 */
  sort?: Array<SortEntry<GroupSortField>>;
}
