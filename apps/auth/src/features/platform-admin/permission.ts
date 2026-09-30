import {
  definePageKey,
  PermissionKey,
  PermissionMatch,
  PermissionResource,
  registerPagePermission,
  routeBasePath,
} from '@/core/permission';

import { PlatformAdminListRoute } from './routes/pages';

/** 平台管理者清單；`platformAdmin:create` 新增、`platformAdmin:update` 編輯與寄設定密碼連結。 */
export const PLATFORM_ADMIN_PAGE = definePageKey('PLATFORM_ADMIN');

export function registerPlatformAdminPagePermissions(): void {
  registerPagePermission(PLATFORM_ADMIN_PAGE, {
    route: routeBasePath(PlatformAdminListRoute),
    rule: {
      resource: PermissionResource.PLATFORM_ADMIN,
      access: [PermissionKey['platformAdmin:read']],
      match: PermissionMatch.EVERY,
    },
  });
}
