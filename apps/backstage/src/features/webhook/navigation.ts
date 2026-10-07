import { registerNavItem } from '@b2b-system/web-core/navigation';

import { NavGroupKey } from '@/core/navigation';

import { WEBHOOK_PAGE } from './permission';

/** 側欄的入口；命令面板的「頁面」也列出它（docs/architecture/frontend/18-command-palette.md §2）。 */
export function registerWebhookNavigation(): void {
  registerNavItem({
    pageKey: WEBHOOK_PAGE,
    to: '/webhook',
    labelKey: 'menu.webhook',
    testId: 'menu-webhook',
    icon: 'network',
    group: NavGroupKey.SYSTEM,
    order: 600,
  });
}
