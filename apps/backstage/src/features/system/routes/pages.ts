import { localeScopeLoader } from '@b2b-system/web-core/locales';
import { RootRoute } from '@b2b-system/web-core/router';
import { createRoute } from '@tanstack/react-router';

import { requireFeature } from '@/core/feature';

import { SYSTEM_LOCALE_SCOPE } from '../locale';

/** 這個 feature 在租戶啟用清單裡的 id（後端 `TENANT_FEATURES`，docs/architecture/05-tenancy.md §12）。 */
export const SYSTEM_SETTING_FEATURE = 'systemSetting';

/**
 * 系統設定（`system:read` 檢視、`system:update` 修改；docs/architecture/backend/12-settings.md）：
 * 依分類列出執行期可調的設定，可以還原預設。
 */
export const SettingListRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: '/system/settings',
  staticData: { titleKey: 'menu.setting' },
  beforeLoad: requireFeature(SYSTEM_SETTING_FEATURE),
  loader: localeScopeLoader(SYSTEM_LOCALE_SCOPE),
});
