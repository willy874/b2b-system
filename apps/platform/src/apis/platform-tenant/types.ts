import type { SortEntry } from '@b2b-system/web-shared/constants';

import type { PlatformTenant } from '@/shared/api-sdk';

/** 後端 `ListPlatformTenantSchema` 的排序白名單（docs/architecture/05-tenancy.md §14.2 D12）。 */
export type TenantSortField =
  | 'createdAt'
  | 'code'
  | 'usersActive'
  | 'storageUsage'
  | 'recentRequests'
  | 'lastActivityAt';

/** `GET /platform/tenants` 的查詢條件；沒帶排序時依建立時間舊到新。 */
export interface TenantListParams {
  offset: number;
  limit: number;
  /** 代碼、名稱或任一網域的部分相符（不分大小寫）。 */
  q?: string;
  status?: PlatformTenant['status'];
  /** 多欄排序，陣列順序即優先順序。 */
  sort?: Array<SortEntry<TenantSortField>>;
}
