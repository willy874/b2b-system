import type { MenuItem, SideNavGroup, SideNavItem } from '@b2b-system/web-core/layout';

import { PREFERENCE_PAGE, PROFILE_PAGE } from '@/features/account';
import { ANNOUNCEMENT_PAGE } from '@/features/announcement';
import { APPROVAL_PAGE } from '@/features/approval';
import { AUDIT_LOG_PAGE } from '@/features/audit-log';
import { FILE_PAGE } from '@/features/file';
import { GROUP_PAGE } from '@/features/group';
import { HOME_PAGE } from '@/features/home';
import { IDENTITY_PROVIDER_PAGE } from '@/features/identity-provider';
import { JOB_PAGE } from '@/features/job';
import { NOTIFICATION_EVENT_PAGE, NOTIFICATION_OVERVIEW_PAGE } from '@/features/notification';
import { PERMISSION_PAGE } from '@/features/permission';
import { ROLE_PAGE } from '@/features/role';
import { SERVICE_ACCOUNT_PAGE } from '@/features/service-account';
import { SETTING_PAGE } from '@/features/system';
import { TAG_PAGE } from '@/features/tag';
import { TRASH_PAGE } from '@/features/trash';
import { USER_PAGE } from '@/features/user';
import { WEBHOOK_PAGE } from '@/features/webhook';

/** 首頁不屬於任何分類，固定列在最上方。 */
export const NAV_TOP_ITEMS: SideNavItem[] = [
  { pageKey: HOME_PAGE, to: '/', labelKey: 'menu.home', testId: 'menu-home', icon: 'home' },
];

/** 側欄的選單資料（由 web-core 的 `SideNav` 渲染）：`app/` 是唯一知道所有 feature 的地方，這是組裝層的本分。 */
export const NAV_GROUPS: SideNavGroup[] = [
  {
    key: 'feature',
    labelKey: 'menu.group.feature',
    testId: 'menu-group-feature',
    items: [
      { pageKey: FILE_PAGE, to: '/file', labelKey: 'menu.file', testId: 'menu-file', icon: 'file' },
    ],
  },
  {
    key: 'people',
    labelKey: 'menu.group.people',
    testId: 'menu-group-people',
    items: [
      {
        pageKey: USER_PAGE,
        to: '/user',
        labelKey: 'menu.user',
        testId: 'menu-user',
        icon: 'users',
      },
      {
        pageKey: ROLE_PAGE,
        to: '/role',
        labelKey: 'menu.role',
        testId: 'menu-role',
        icon: 'shield',
      },
      {
        pageKey: GROUP_PAGE,
        to: '/group',
        labelKey: 'menu.userGroup',
        testId: 'menu-group',
        icon: 'users',
      },
      {
        pageKey: SERVICE_ACCOUNT_PAGE,
        to: '/service-account',
        labelKey: 'menu.serviceAccount',
        testId: 'menu-service-account',
        icon: 'monitor',
      },
      {
        pageKey: PERMISSION_PAGE,
        to: '/permission',
        labelKey: 'menu.permission',
        testId: 'menu-permission',
        icon: 'key',
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
        testId: 'menu-auditLog',
        icon: 'list',
      },
      {
        pageKey: APPROVAL_PAGE,
        to: '/approval',
        labelKey: 'menu.approval',
        testId: 'menu-approval',
        icon: 'check',
      },
      { pageKey: JOB_PAGE, to: '/job', labelKey: 'menu.job', testId: 'menu-job', icon: 'monitor' },
      {
        pageKey: IDENTITY_PROVIDER_PAGE,
        to: '/identity-provider',
        labelKey: 'menu.identityProvider',
        testId: 'menu-identity-provider',
        icon: 'key',
      },
      {
        pageKey: TAG_PAGE,
        to: '/tag',
        labelKey: 'menu.tag',
        testId: 'menu-tag',
        icon: 'pin',
      },
      {
        pageKey: WEBHOOK_PAGE,
        to: '/webhook',
        labelKey: 'menu.webhook',
        testId: 'menu-webhook',
        icon: 'network',
      },
      {
        pageKey: TRASH_PAGE,
        to: '/trash',
        labelKey: 'menu.trash',
        testId: 'menu-trash',
        icon: 'trash',
      },
      {
        pageKey: SETTING_PAGE,
        to: '/system/settings',
        labelKey: 'menu.setting',
        testId: 'menu-setting',
        icon: 'settings',
      },
      {
        pageKey: ANNOUNCEMENT_PAGE,
        to: '/announcement',
        labelKey: 'menu.announcement',
        testId: 'menu-announcement',
        icon: 'calendar',
      },
      {
        pageKey: NOTIFICATION_OVERVIEW_PAGE,
        to: '/notification/all',
        labelKey: 'menu.notificationOverview',
        testId: 'menu-notification-overview',
        icon: 'bell',
      },
      {
        pageKey: NOTIFICATION_EVENT_PAGE,
        to: '/notification/events',
        labelKey: 'menu.notificationEvent',
        testId: 'menu-notification-event',
        icon: 'bell',
      },
    ],
  },
];

/** 帳號選單裡的頁面（依頁面權限過濾）。 */
export const ACCOUNT_PAGES: MenuItem[] = [
  { pageKey: PROFILE_PAGE, to: '/profile', labelKey: 'menu.profile', icon: 'user' },
  { pageKey: PREFERENCE_PAGE, to: '/preference', labelKey: 'menu.preference', icon: 'settings' },
];
