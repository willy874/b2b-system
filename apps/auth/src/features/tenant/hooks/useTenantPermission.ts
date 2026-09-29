import { usePagePermission } from '@/core/permission';

import { TENANT_PAGE } from '../permission';

/** 租戶管理：`tenant:create`（建立、重試佈建）、`tenant:update`（改名、網域、停用）、`tenant:delete`。 */
export function useTenantPermission() {
  return usePagePermission(TENANT_PAGE);
}
