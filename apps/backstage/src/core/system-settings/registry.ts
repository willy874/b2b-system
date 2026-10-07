import type { PageKey } from '@b2b-system/web-core/permission';
import { createRegistry } from '@b2b-system/web-shared/registry';

/**
 * 系統設定頁的一個分頁（docs/architecture/frontend/02-plugin-system.md §4.5）。
 * 分頁屬於登記它的 feature（安全性的 MFA 政策、站內通知的事件管理……），系統設定只負責把它們排在同一個外框裡：
 * feature 之間不互相 import，拿掉任何一個 feature，它的分頁就消失。
 */
export interface SystemSettingsTab {
  /** 註冊表的鍵；發佈後不改名。 */
  key: string;
  /** 分頁的頁面鍵：沒有權限、或所屬 feature 未啟用（頁面鍵沒有登記）時不顯示這個分頁。 */
  pageKey: PageKey;
  /** 分頁的路徑；要落在 `pageKey` 上（`app/__tests__/navigation.test.ts` 檢查）。 */
  to: string;
  /** 放在 app 的全域語系包（`menu.*`）：外框在每個分頁都會渲染，分頁自己的 scope 未必載入。 */
  labelKey: string;
  /** 數字小的在前；預留間隔。 */
  order: number;
}

/** 可訂閱：可啟用的 feature 安裝或卸載時，分頁跟著出現或消失。 */
export const systemSettingsTabRegistry = createRegistry<string, SystemSettingsTab>(
  'System settings tab',
);

/** feature 在 plugin 的同步階段登記自己的分頁（與 `registerPagePermission` 同一處）。回傳反註冊函式。 */
export function registerSystemSettingsTab(tab: SystemSettingsTab): () => void {
  return systemSettingsTabRegistry.register(tab.key, tab);
}

/** 測試用。 */
export function resetSystemSettingsTabs(): void {
  systemSettingsTabRegistry.reset();
}
