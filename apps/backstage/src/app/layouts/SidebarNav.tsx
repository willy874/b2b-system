import { Link, useRouterState } from '@tanstack/react-router';
import { useId, useMemo, useState } from 'react';

import { Icon } from '@/components/Icon';
import { useTranslation } from '@/core/locales';
import { usePageAccessChecker } from '@/core/permission';
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
import { cn } from '@/shared/utils';

import { isMenuItemActive, useMenuItems } from './menu';
import type { MenuItem } from './menu';

interface NavItem extends MenuItem {
  /** 完整字面量（docs/conventions/06-literal-strings.md §3.3），E2E 以此定位側邊選單項 */
  testId: string;
}

interface NavGroup {
  key: string;
  labelKey: string;
  /** 父選單（展開／收合按鈕）的 testid，同樣是完整字面量 */
  testId: string;
  items: NavItem[];
}

/** 首頁不屬於任何分類，固定列在最上方。 */
const TOP_ITEMS: NavItem[] = [
  { pageKey: HOME_PAGE, to: '/', labelKey: 'menu.home', testId: 'menu-home', icon: 'home' },
];

/** `app/` 是唯一知道所有 feature 的地方，這是組裝層的本分。 */
const MENU_GROUPS: NavGroup[] = [
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

/** 分類裡一個能進的頁面都沒有時，連父選單一起隱藏。 */
function useMenuGroups(groups: NavGroup[]): NavGroup[] {
  const { hydrated, canAccessPage } = usePageAccessChecker();
  return useMemo(
    () =>
      hydrated
        ? groups
            .map((group) => ({
              ...group,
              items: group.items.filter((item) => canAccessPage(item.pageKey)),
            }))
            .filter((group) => group.items.length > 0)
        : [],
    [canAccessPage, hydrated, groups],
  );
}

function defaultOpenKeys(activeKey: string | undefined): ReadonlySet<string> {
  return new Set(activeKey ? [activeKey] : []);
}

/**
 * 預設只展開當前頁面所在的分類。使用者手動展開／收合的狀態保留到「當前分類」改變為止，
 * 換到別的分類（或回首頁）時回到預設。
 */
function useOpenGroups(activeKey: string | undefined) {
  const [openKeys, setOpenKeys] = useState(() => defaultOpenKeys(activeKey));
  const [syncedKey, setSyncedKey] = useState(activeKey);
  // 在 render 中依前一個值調整 state（react.dev「Adjusting some state when a prop changes」），不用 effect 避免閃一下
  if (syncedKey !== activeKey) {
    setSyncedKey(activeKey);
    setOpenKeys(defaultOpenKeys(activeKey));
  }

  const toggle = (key: string) => {
    setOpenKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return { openKeys, toggle };
}

function NavLink({
  item,
  pathname,
  collapsed,
}: {
  item: NavItem;
  pathname: string;
  collapsed: boolean;
}) {
  const { t } = useTranslation();
  return (
    <Link
      to={item.to}
      className={cn(
        'ge-shell__nav-item',
        isMenuItemActive(item.to, pathname) && 'ge-shell__nav-item--active',
      )}
      data-testid={item.testId}
      title={collapsed ? t(item.labelKey) : undefined}
    >
      <Icon name={item.icon} size={16} />
      {!collapsed && <span>{t(item.labelKey)}</span>}
    </Link>
  );
}

export function SidebarNav({ collapsed }: { collapsed: boolean }) {
  const { t } = useTranslation();
  const baseId = useId();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const topItems = useMenuItems(TOP_ITEMS);
  const groups = useMenuGroups(MENU_GROUPS);
  const activeKey = groups.find((group) =>
    group.items.some((item) => isMenuItemActive(item.to, pathname)),
  )?.key;
  const { openKeys, toggle } = useOpenGroups(activeKey);

  return (
    <nav className="ge-shell__nav">
      {topItems.map((item) => (
        <NavLink key={item.testId} item={item} pathname={pathname} collapsed={collapsed} />
      ))}
      {groups.map((group) => {
        const links = group.items.map((item) => (
          <NavLink key={item.testId} item={item} pathname={pathname} collapsed={collapsed} />
        ));

        // 收合成圖示欄時放不下父選單，子項全部列出、以分隔線標出分類邊界
        if (collapsed) {
          return (
            <div key={group.key} className="ge-shell__nav-group">
              <hr className="ge-shell__nav-divider" />
              {links}
            </div>
          );
        }

        const open = openKeys.has(group.key);
        const listId = `${baseId}-${group.key}`;
        return (
          <div key={group.key} className="ge-shell__nav-group">
            <button
              type="button"
              className={cn(
                'ge-shell__nav-parent',
                // 收起來時仍標出當前頁面在哪個分類裡
                !open && group.key === activeKey && 'ge-shell__nav-parent--active',
              )}
              aria-expanded={open}
              aria-controls={listId}
              onClick={() => toggle(group.key)}
              data-testid={group.testId}
            >
              <span className="flex-1">{t(group.labelKey)}</span>
              <Icon
                name="chevron-down"
                size={14}
                className={cn('ge-shell__nav-chevron', open && 'ge-shell__nav-chevron--open')}
              />
            </button>
            {/* 收合時仍留在 DOM（hidden），權限過濾與展開狀態互不影響 */}
            <div id={listId} className="ge-shell__nav-children" hidden={!open}>
              {links}
            </div>
          </div>
        );
      })}
    </nav>
  );
}
