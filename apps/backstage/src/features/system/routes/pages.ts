import { localeScopeLoader } from '@b2b-system/web-core/locales';
import { RootRoute } from '@b2b-system/web-core/router';
import { createRoute } from '@tanstack/react-router';

import { requireFeature } from '@/core/feature';

import { SYSTEM_LOCALE_SCOPE } from '../locale';

/** 「一般」分頁在租戶啟用清單裡的 id（後端 `TENANT_FEATURES`，docs/architecture/05-tenancy.md §12）。 */
export const SYSTEM_SETTING_FEATURE = 'systemSetting';

/**
 * 系統設定的入口（側欄的「系統設定」）：導向第一個看得到的分頁。分頁由各 feature 登記到 `core/system-settings`
 * （一般、安全性、事件通知；docs/architecture/frontend/02-plugin-system.md §4.5）。常駐：平台關掉「一般」分頁時，
 * 安全政策與事件通知仍要找得到。
 */
export const SystemRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: '/system',
  staticData: { titleKey: 'menu.setting' },
});

/**
 * 「一般」分頁（`system:read` 檢視、`system:update` 修改；docs/architecture/backend/12-settings.md）：
 * 依分類列出執行期可調的設定，可以還原預設。屬於可由平台關閉的 feature `systemSetting`。
 */
export const SettingListRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: '/system/settings',
  staticData: { titleKey: 'menu.setting' },
  beforeLoad: requireFeature(SYSTEM_SETTING_FEATURE),
  loader: localeScopeLoader(SYSTEM_LOCALE_SCOPE),
});
