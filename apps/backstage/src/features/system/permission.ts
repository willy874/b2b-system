import {
  definePageKey,
  PermissionKey,
  PermissionMatch,
  PermissionResource,
  registerPagePermission,
  routeBasePath,
} from '@/core/permission';

import { SettingListRoute, SystemRoute } from './routes/pages';

/**
 * 系統設定的入口：看得到任一個分頁就能進來（一般與事件通知要 `system:read`、安全性要 `mfaPolicy:read`）。
 * 進來之後由各分頁自己的頁面鍵把關。
 */
export const SYSTEM_PAGE = definePageKey('SYSTEM');

/** 「一般」分頁：執行期可調的系統設定。 */
export const SETTING_PAGE = definePageKey('SETTING');

/** 常駐：入口。 */
export function registerSystemPagePermissions(): void {
  registerPagePermission(SYSTEM_PAGE, {
    route: routeBasePath(SystemRoute),
    rule: {
      access: [PermissionKey['system:read'], PermissionKey['mfaPolicy:read']],
      match: PermissionMatch.SOME,
    },
  });
}

/** 可關閉的 feature `systemSetting`：未啟用時頁面鍵不登記，「一般」分頁跟著消失。 */
export function registerSettingPagePermissions(): void {
  registerPagePermission(SETTING_PAGE, {
    route: routeBasePath(SettingListRoute),
    rule: {
      resource: PermissionResource.SYSTEM,
      access: [PermissionKey['system:read']],
      match: PermissionMatch.EVERY,
    },
  });
}
