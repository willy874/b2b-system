import { registerNavItem } from '@b2b-system/web-core/navigation';

import { NavGroupKey } from '@/core/navigation';

import { TAG_PAGE } from './permission';

/** 側欄的入口；命令面板的「頁面」也列出它（docs/architecture/frontend/18-command-palette.md §2）。 */
export function registerTagNavigation(): void {
  registerNavItem({
    pageKey: TAG_PAGE,
    to: '/tag',
    labelKey: 'menu.tag',
    testId: 'menu-tag',
    icon: 'tag',
    group: NavGroupKey.SYSTEM,
    order: 500,
  });
}
