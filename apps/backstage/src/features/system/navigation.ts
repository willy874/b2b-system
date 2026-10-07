import { registerNavItem } from '@b2b-system/web-core/navigation';

import { NavGroupKey } from '@/core/navigation';
import { registerSystemSettingsTab } from '@/core/system-settings';

import { SETTING_PAGE, SYSTEM_PAGE } from './permission';

/** 側欄的入口；命令面板的「頁面」也列出它（docs/architecture/frontend/18-command-palette.md §2）。 */
export function registerSystemNavigation(): void {
  registerNavItem({
    pageKey: SYSTEM_PAGE,
    to: '/system',
    labelKey: 'menu.setting',
    testId: 'menu-setting',
    icon: 'settings',
    group: NavGroupKey.SYSTEM,
    order: 800,
  });
}

/** 系統設定的「一般」分頁（docs/architecture/frontend/02-plugin-system.md §4.5）。 */
export function registerSettingTab(): void {
  registerSystemSettingsTab({
    key: 'general',
    pageKey: SETTING_PAGE,
    to: '/system/settings',
    labelKey: 'menu.settingGeneral',
    order: 100,
  });
}
