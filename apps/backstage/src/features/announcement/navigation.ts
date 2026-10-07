import { registerNavItem } from '@b2b-system/web-core/navigation';

import { NavGroupKey } from '@/core/navigation';

import { ANNOUNCEMENT_PAGE } from './permission';

/** 側欄的入口；命令面板的「頁面」也列出它（docs/architecture/frontend/18-command-palette.md §2）。 */
export function registerAnnouncementNavigation(): void {
  registerNavItem({
    pageKey: ANNOUNCEMENT_PAGE,
    to: '/announcement',
    labelKey: 'menu.announcement',
    testId: 'menu-announcement',
    icon: 'megaphone',
    group: NavGroupKey.SYSTEM,
    order: 900,
  });
}
