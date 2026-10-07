import { Icon } from '@b2b-system/ui/Icon';
import { Link, useRouterState } from '@tanstack/react-router';
import { useId, useMemo, useState } from 'react';

import { useTranslation } from '../locales';
import { usePageAccessChecker } from '../permission';
import { isMenuItemActive, useMenuItems } from './menu';
import type { MenuItem } from './menu';

import styles from './SideNav.module.css';

export interface SideNavItem extends MenuItem {
  /** 完整字面量（docs/conventions/06-literal-strings.md §3.3），E2E 以此定位側邊選單項 */
  testId: string;
}

export interface SideNavGroup {
  key: string;
  labelKey: string;
  /** 父選單（展開／收合按鈕）的 testid，同樣是完整字面量 */
  testId: string;
  items: SideNavItem[];
}

export interface SideNavProps {
  /** 不屬於任何分類、固定列在最上方的項目（首頁）。 */
  topItems: SideNavItem[];
  /** 其餘頁面依分類列在父選單底下。選單資料由 app 的 `app/layouts/` 傳入（只有 app 認識所有 feature）。 */
  groups: SideNavGroup[];
  /** 收合成圖示欄 */
  collapsed: boolean;
}

/** 分類裡一個能進的頁面都沒有時，連父選單一起隱藏。 */
function useMenuGroups(groups: SideNavGroup[]): SideNavGroup[] {
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
  item: SideNavItem;
  pathname: string;
  collapsed: boolean;
}) {
  const { t } = useTranslation();
  return (
    <Link
      to={item.to}
      className={styles.item}
      data-active={isMenuItemActive(item.to, pathname) || undefined}
      data-testid={item.testId}
      title={collapsed ? t(item.labelKey) : undefined}
    >
      <Icon name={item.icon} size={16} />
      {!collapsed && <span>{t(item.labelKey)}</span>}
    </Link>
  );
}

/**
 * 分組的側邊選單（docs/architecture/frontend/04-routing.md §9）：依頁面權限過濾，
 * 父選單展開／收合；收合成圖示欄時子項全部列出、以分隔線標出分類邊界。
 */
export function SideNav({ topItems, groups, collapsed }: SideNavProps) {
  const { t } = useTranslation();
  const baseId = useId();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const visibleTopItems = useMenuItems(topItems);
  const visibleGroups = useMenuGroups(groups);
  const activeKey = visibleGroups.find((group) =>
    group.items.some((item) => isMenuItemActive(item.to, pathname)),
  )?.key;
  const { openKeys, toggle } = useOpenGroups(activeKey);

  return (
    <nav className={styles.nav}>
      {visibleTopItems.map((item) => (
        <NavLink key={item.testId} item={item} pathname={pathname} collapsed={collapsed} />
      ))}
      {visibleGroups.map((group) => {
        const links = group.items.map((item) => (
          <NavLink key={item.testId} item={item} pathname={pathname} collapsed={collapsed} />
        ));

        // 收合成圖示欄時放不下父選單，子項全部列出、以分隔線標出分類邊界
        if (collapsed) {
          return (
            <div key={group.key} className={styles.group}>
              <hr className={styles.divider} />
              {links}
            </div>
          );
        }

        const open = openKeys.has(group.key);
        const listId = `${baseId}-${group.key}`;
        return (
          <div key={group.key} className={styles.group}>
            <button
              type="button"
              className={styles.parent}
              // 收起來時仍標出當前頁面在哪個分類裡
              data-active={(!open && group.key === activeKey) || undefined}
              aria-expanded={open}
              aria-controls={listId}
              onClick={() => toggle(group.key)}
              data-testid={group.testId}
            >
              <span className="flex-1">{t(group.labelKey)}</span>
              <Icon
                name="chevron-down"
                size={14}
                className={styles.chevron}
                data-open={open || undefined}
              />
            </button>
            {/* 收合時仍留在 DOM（hidden），權限過濾與展開狀態互不影響 */}
            <div id={listId} className={styles.children} hidden={!open}>
              {links}
            </div>
          </div>
        );
      })}
    </nav>
  );
}
