import type { SortEntry } from '@b2b-system/web-shared/constants';

/** 後端 `ListRoleSchema` 的排序白名單。 */
export type RoleSortField = 'createdAt' | 'name' | 'slug' | 'permissionCount' | 'userCount';

export interface RoleListParams {
  offset: number;
  limit: number;
  keyword?: string;
  isSystem?: boolean;
  /** 多欄排序，陣列順序即優先順序。 */
  sort?: Array<SortEntry<RoleSortField>>;
}
