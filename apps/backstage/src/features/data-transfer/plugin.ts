import type { AppDynamicPluginFactory } from '@b2b-system/web-core/app';

import { registerDataTransferNavigation } from './navigation';
import { registerDataTransferPagePermissions } from './permission';
import { registerDataTransferRouteLinks } from './routeLinks';

/**
 * 可啟用的 feature：由 `app/features.ts` 依租戶的啟用清單安裝（docs/architecture/frontend/02-plugin-system.md §9.2 D1）。
 * 字串都在 web-core 的 `dataTransfer`（匯入頁在各資源的 feature 也要用），沒有自己的語系包。
 */
export function appContextPlugin(): AppDynamicPluginFactory {
  return () => {
    registerDataTransferPagePermissions();
    registerDataTransferNavigation();
    registerDataTransferRouteLinks();
    return { name: 'app-data-transfer-feature-plugin' };
  };
}
