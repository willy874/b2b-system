import {
  definePageKey,
  PermissionKey,
  PermissionMatch,
  PermissionResource,
  registerPagePermission,
  routeBasePath,
} from '@/core/permission';

import { SettingListRoute } from './routes/pages';

/** 系統設定頁。 */
export const SETTING_PAGE = definePageKey('SETTING');

export function registerSystemPagePermissions(): void {
  registerPagePermission(SETTING_PAGE, {
    route: routeBasePath(SettingListRoute),
    rule: {
      resource: PermissionResource.SYSTEM,
      access: [PermissionKey['system:read']],
      match: PermissionMatch.EVERY,
    },
  });
}
