import type { SortEntry } from '@b2b-system/web-shared/constants';

import type { UserStatus } from '@/shared/api-sdk';

/** 後端 `ListUserSchema` 的排序白名單。 */
export type UserSortField = 'createdAt' | 'email' | 'displayName' | 'lastLoginAt';

export interface UserListParams {
  offset: number;
  limit: number;
  keyword?: string;
  status?: UserStatus[];
  roleId?: string[];
  /** 有沒有設定 MFA（docs/architecture/backend/21-mfa.md §8）。 */
  mfa?: 'true' | 'false';
  /** 貼了其中任一個標籤（docs/architecture/backend/18-tag.md §7.2 D6）。 */
  tagId?: string[];
  /** 多欄排序，陣列順序即優先順序。 */
  sort?: Array<SortEntry<UserSortField>>;
}
