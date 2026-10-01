import { createRoute } from '@tanstack/react-router';

import { requireFeature } from '@/core/feature';
import { localeScopeLoader } from '@/core/locales';
import { RootRoute } from '@/core/router';

import { SYSTEM_LOCALE_SCOPE } from '../locale';

/** 這個 feature 在租戶啟用清單裡的 id（後端 `TENANT_FEATURES`，docs/adr/0029-toggleable-platform-features.md）。 */
export const SYSTEM_SETTING_FEATURE = 'systemSetting';

/**
 * 系統設定（`system:read` 檢視、`system:update` 修改；docs/architecture/backend/12-settings.md）：
 * 依分類列出執行期可調的設定，可以還原預設。
 */
export const SettingListRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: '/system/settings',
  beforeLoad: requireFeature(SYSTEM_SETTING_FEATURE),
  loader: localeScopeLoader(SYSTEM_LOCALE_SCOPE),
});
