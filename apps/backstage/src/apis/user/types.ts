import type { SortEntry } from '@b2b-system/web-shared/constants';

import type { UserStatus } from '@/shared/api-sdk';

/** 後端 `ListUserSchema` 的排序白名單。 */
export type UserSortField = 'createdAt' | 'email' | 'displayName' | 'lastLoginAt';

export interface UserListParams {
  offset: number;
  limit: number;
  keyword?: string;
  /** 只列這些使用者（一次最多 `USER_IDS_PER_REQUEST` 個）。 */
  id?: string[];
  status?: UserStatus[];
  roleId?: string[];
  /** `roleId` 也算經由群組（含巢狀）持有的人；預設只看直接持有。 */
  includeGroupRoles?: boolean;
  /** 有沒有設定 MFA（docs/architecture/backend/21-mfa.md §8）。 */
  mfa?: 'true' | 'false';
  /** 貼了其中任一個標籤（docs/architecture/backend/18-tag.md §7.2 D6）。 */
  tagId?: string[];
  /**
   * 屬於這個部門（docs/architecture/backend/23-organization.md §4）；`includeDescendants` 時含下層部門。
   * 租戶沒有啟用 `organization` 時後端回 `VALIDATION_FAILED`，不要帶。
   */
  orgUnitId?: string;
  includeDescendants?: boolean;
  /** 多欄排序，陣列順序即優先順序。 */
  sort?: Array<SortEntry<UserSortField>>;
}
