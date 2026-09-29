import { usePagePermission } from '@/core/permission';

import { IDENTITY_PROVIDER_PAGE } from '../permission';

/** 外部 IdP 連線管理頁：`identityProvider:*` 各自對應建立、編輯、刪除。 */
export function useIdentityProviderPermission() {
  return usePagePermission(IDENTITY_PROVIDER_PAGE);
}
