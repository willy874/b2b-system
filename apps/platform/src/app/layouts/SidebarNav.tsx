import { Icon } from '@b2b-system/ui/Icon';
import { isMenuItemActive, useMenuItems } from '@b2b-system/web-core/layout';
import type { MenuItem } from '@b2b-system/web-core/layout';
import { useTranslation } from '@b2b-system/web-core/locales';
import { cn } from '@b2b-system/web-shared/utils';
import { Link, useRouterState } from '@tanstack/react-router';
import { useId, useMemo, useState } from 'react';

import { usePageAccessChecker } from '@/core/permission';
import { AUDIT_LOG_PAGE } from '@/features/audit-log';
import { FEATURE_FLAG_PAGE } from '@/features/feature-flag';
import { HOME_PAGE } from '@/features/home';
import { JOB_PAGE } from '@/features/job';
import { PLATFORM_ADMIN_PAGE } from '@/features/platform-admin';
import { TENANT_PAGE } from '@/features/tenant';

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

/**
 * `app/` 是唯一知道所有 feature 的地方，這是組裝層的本分。分類比照 backstage 的側欄：
 * 租戶（客戶與它們用得到的功能）、平台管理者、維運（稽核與背景工作）。
 */
const MENU_GROUPS: NavGroup[] = [
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
        'ga-shell__nav-item',
        isMenuItemActive(item.to, pathname) && 'ga-shell__nav-item--active',
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
    <nav className="ga-shell__nav">
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
            <div key={group.key} className="ga-shell__nav-group">
              <hr className="ga-shell__nav-divider" />
              {links}
            </div>
          );
        }

        const open = openKeys.has(group.key);
        const listId = `${baseId}-${group.key}`;
        return (
          <div key={group.key} className="ga-shell__nav-group">
            <button
              type="button"
              className={cn(
                'ga-shell__nav-parent',
                // 收起來時仍標出當前頁面在哪個分類裡
                !open && group.key === activeKey && 'ga-shell__nav-parent--active',
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
                className={cn('ga-shell__nav-chevron', open && 'ga-shell__nav-chevron--open')}
              />
            </button>
            {/* 收合時仍留在 DOM（hidden），權限過濾與展開狀態互不影響 */}
            <div id={listId} className="ga-shell__nav-children" hidden={!open}>
              {links}
            </div>
          </div>
        );
      })}
    </nav>
  );
}
