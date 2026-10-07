import { registerNavItem } from '@b2b-system/web-core/navigation';

import { NavGroupKey } from '@/core/navigation';

import { FILE_PAGE } from './permission';

/** 側欄的入口；命令面板的「頁面」也列出它（docs/architecture/frontend/18-command-palette.md §2）。 */
export function registerFileNavigation(): void {
  registerNavItem({
    pageKey: FILE_PAGE,
    to: '/file',
    labelKey: 'menu.file',
    testId: 'menu-file',
    icon: 'file',
    group: NavGroupKey.FEATURE,
    order: 100,
  });
}
