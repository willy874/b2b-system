import { registerNavItem } from '@b2b-system/web-core/navigation';

import { NavGroupKey } from '@/core/navigation';

import { JOB_PAGE } from './permission';

/** 側欄的入口；命令面板的「頁面」也列出它（docs/architecture/frontend/18-command-palette.md §2）。 */
export function registerJobNavigation(): void {
  registerNavItem({
    pageKey: JOB_PAGE,
    to: '/job',
    labelKey: 'menu.job',
    testId: 'menu-job',
    icon: 'monitor',
    group: NavGroupKey.SYSTEM,
    order: 200,
  });
}
