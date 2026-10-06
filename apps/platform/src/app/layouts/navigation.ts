import type { MenuItem, SideNavGroup, SideNavItem } from '@b2b-system/web-core/layout';

import { PREFERENCE_PAGE, PROFILE_PAGE } from '@/features/account';
import { AUDIT_LOG_PAGE } from '@/features/audit-log';
import { FEATURE_FLAG_PAGE } from '@/features/feature-flag';
import { HOME_PAGE } from '@/features/home';
import { JOB_PAGE } from '@/features/job';
import { PLATFORM_ADMIN_PAGE } from '@/features/platform-admin';
import { TENANT_PAGE } from '@/features/tenant';

/** 首頁不屬於任何分類，固定列在最上方。 */
export const NAV_TOP_ITEMS: SideNavItem[] = [
  { pageKey: HOME_PAGE, to: '/', labelKey: 'menu.home', testId: 'menu-home', icon: 'home' },
];

/**
 * 側欄的選單資料（由 web-core 的 `SideNav` 渲染）：`app/` 是唯一知道所有 feature 的地方，這是組裝層的本分。
 * 分類：租戶（客戶與它們用得到的功能）、平台管理者、維運（稽核與背景工作）。
 */
export const NAV_GROUPS: SideNavGroup[] = [
  {
    key: 'tenant',
    labelKey: 'menu.group.tenant',
    testId: 'menu-group-tenant',
    items: [
      {
        pageKey: TENANT_PAGE,
        to: '/tenant',
        labelKey: 'menu.tenant',
        testId: 'menu-tenant',
        icon: 'network',
      },
      {
        pageKey: FEATURE_FLAG_PAGE,
        to: '/feature-flag',
        labelKey: 'menu.featureFlag',
        testId: 'menu-feature-flag',
        icon: 'pin',
      },
    ],
  },
  {
    key: 'people',
    labelKey: 'menu.group.people',
    testId: 'menu-group-people',
    items: [
      {
        pageKey: PLATFORM_ADMIN_PAGE,
        to: '/admin',
        labelKey: 'menu.platformAdmin',
        testId: 'menu-platform-admin',
        icon: 'users',
      },
    ],
  },
  {
    key: 'system',
    labelKey: 'menu.group.system',
    testId: 'menu-group-system',
    items: [
      {
        pageKey: AUDIT_LOG_PAGE,
        to: '/audit-log',
        labelKey: 'menu.auditLog',
        testId: 'menu-audit-log',
        icon: 'list',
      },
      { pageKey: JOB_PAGE, to: '/job', labelKey: 'menu.job', testId: 'menu-job', icon: 'monitor' },
    ],
  },
];

/** 帳號選單裡的頁面（依頁面權限過濾）。 */
export const ACCOUNT_PAGES: MenuItem[] = [
  { pageKey: PROFILE_PAGE, to: '/profile', labelKey: 'menu.profile', icon: 'user' },
  { pageKey: PREFERENCE_PAGE, to: '/preference', labelKey: 'menu.preference', icon: 'settings' },
];
