import { usePagePermission } from '@/core/permission';

import { PLATFORM_ADMIN_PAGE } from '../permission';

/** 平台管理者：`platformAdmin:create`（新增）、`platformAdmin:update`（編輯、寄設定密碼連結）；沒有刪除。 */
export function usePlatformAdminPermission() {
  return usePagePermission(PLATFORM_ADMIN_PAGE);
}
