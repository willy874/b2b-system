import { createRoute } from '@tanstack/react-router';

import { localeScopeLoader } from '@/core/locales';
import { RootRoute } from '@/core/router';

import { SYSTEM_LOCALE_SCOPE } from '../locale';

/**
 * 系統設定（`system:read` 檢視、`system:update` 修改；docs/architecture/backend/12-settings.md）：
 * 依分類列出執行期可調的設定，可以還原預設。
 */
export const SettingListRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: '/system/settings',
  loader: localeScopeLoader(SYSTEM_LOCALE_SCOPE),
});
