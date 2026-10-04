import type { PlatformTenant } from '@/shared/api-sdk';

/** `GET /platform/tenants` 的查詢條件（依建立時間舊到新）。 */
export interface TenantListParams {
  offset: number;
  limit: number;
  /** 代碼、名稱或任一網域的部分相符（不分大小寫）。 */
  q?: string;
  status?: PlatformTenant['status'];
}
