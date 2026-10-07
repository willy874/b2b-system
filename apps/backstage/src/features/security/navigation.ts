import { registerSystemSettingsTab } from '@/core/system-settings';

import { SECURITY_MFA_PAGE } from './permission';

/** 系統設定的「安全性」分頁（docs/architecture/frontend/02-plugin-system.md §4.5）；側欄只有「系統設定」一個入口。 */
export function registerSecurityNavigation(): void {
  registerSystemSettingsTab({
    key: 'security',
    pageKey: SECURITY_MFA_PAGE,
    to: '/system/security',
    labelKey: 'menu.security',
    order: 200,
  });
}
