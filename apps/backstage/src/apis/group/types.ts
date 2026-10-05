import type { SortEntry } from '@b2b-system/web-shared/constants';

/** 後端 `ListGroupSchema` 的排序白名單。 */
export type GroupSortField = 'createdAt' | 'name' | 'memberCount' | 'roleCount';

export interface GroupListParams {
  offset: number;
  limit: number;
  keyword?: string;
  /** 這位使用者所在的群組（直接或經由巢狀群組；每一列帶 `membership`）。 */
  userId?: string;
  /** 持有這個角色的群組。 */
  roleId?: string;
  /** 多欄排序，陣列順序即優先順序。 */
  sort?: Array<SortEntry<GroupSortField>>;
}
