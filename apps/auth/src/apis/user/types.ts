import type { UserStatus } from '@/shared/api-sdk';
import type { SortEntry } from '@/shared/constants';

/** 後端 `ListUserSchema` 的排序白名單。 */
export type UserSortField = 'createdAt' | 'email' | 'displayName' | 'lastLoginAt';

export interface UserListParams {
  offset: number;
  limit: number;
  keyword?: string;
  status?: UserStatus[];
  roleId?: string[];
  /** 多欄排序，陣列順序即優先順序。 */
  sort?: Array<SortEntry<UserSortField>>;
}
