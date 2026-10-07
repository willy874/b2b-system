import { registerNavItem } from '@b2b-system/web-core/navigation';

import { NavGroupKey } from '@/core/navigation';

import { TRASH_PAGE } from './permission';

/** 側欄的入口；命令面板的「頁面」也列出它（docs/architecture/frontend/18-command-palette.md §2）。 */
export function registerTrashNavigation(): void {
  registerNavItem({
    pageKey: TRASH_PAGE,
    to: '/trash',
    labelKey: 'menu.trash',
    testId: 'menu-trash',
    icon: 'trash',
    group: NavGroupKey.SYSTEM,
    order: 700,
  });
}
