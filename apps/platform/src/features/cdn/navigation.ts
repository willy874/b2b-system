import { registerNavItem } from '@b2b-system/web-core/navigation';

import { NavGroupKey } from '@/core/navigation';

import { CDN_PAGE } from './permission';

/** 側欄的入口：「系統管理」（稽核、背景工作之後；側欄沒有「平台管理」群組）；命令面板的「頁面」也列出它。 */
export function registerCdnNavigation(): void {
  registerNavItem({
    pageKey: CDN_PAGE,
    to: '/cdn',
    labelKey: 'menu.cdn',
    testId: 'menu-cdn',
    icon: 'globe',
    group: NavGroupKey.SYSTEM,
    order: 300,
  });
}
