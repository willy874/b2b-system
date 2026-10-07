import { registerNavItem } from '@b2b-system/web-core/navigation';

import { NavGroupKey } from '@/core/navigation';

import { AUDIT_LOG_PAGE } from './permission';

/** 側欄的入口；命令面板的「頁面」也列出它（docs/architecture/frontend/18-command-palette.md §2）。 */
export function registerAuditLogNavigation(): void {
  registerNavItem({
    pageKey: AUDIT_LOG_PAGE,
    to: '/audit-log',
    labelKey: 'menu.auditLog',
    testId: 'menu-auditLog',
    icon: 'list',
    group: NavGroupKey.SYSTEM,
    order: 100,
  });
}
