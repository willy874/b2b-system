import { Icon } from '@b2b-system/ui/Icon';
import { Link, useRouterState } from '@tanstack/react-router';
import { useId, useMemo, useState } from 'react';

import { useTranslation } from '../locales';
import { usePageAccessChecker } from '../permission';
import { isMenuItemActive, useMenuItems } from './menu';
import type { MenuItem } from './menu';

import styles from './SideNav.module.css';

export interface SideNavItem extends MenuItem {
  /** 完整字面量（docs/coding-standards/06-literal-strings.md §3.3），E2E 以此定位側邊選單項 */
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

/** 徽章的數字超過這個值時顯示 `99+`。 */
const BADGE_MAX = 99;

/**
 * 側欄項目的數字徽章。`useCount` 是項目登記的 hook（`NavItem.useBadge`）：這個元件只在有登記時才渲染，
 * 同一個位置永遠呼叫同一個 hook。`dot`：收起來的分類與圖示欄只顯示一個點。
 */
function NavBadge({
  useCount,
  labelKey,
  dot,
}: {
  useCount: () => number | undefined;
  labelKey: string;
  dot?: boolean;
}) {
  const { t } = useTranslation();
  // 項目登記的 hook 在這個元件的一生中固定（元件以項目為 key 渲染），每次 render 呼叫的是同一個 hook
  // oxlint-disable-next-line react/hooks
  const count = useCount() ?? 0;
  if (count <= 0) return null;
  const label = t('layout.badge', { name: t(labelKey), count });
  return (
    <span
      className={dot ? styles.dot : styles.badge}
      title={label}
      data-testid={dot ? 'nav-badge-dot' : 'nav-badge'}
      data-value={count}
    >
      {/* 看得到的是數字或點；報讀器念完整的一句 */}
      {!dot && <span aria-hidden>{count > BADGE_MAX ? `${BADGE_MAX}+` : count}</span>}
      <span className="sr-only">{label}</span>
    </span>
  );
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
      {!collapsed && <span className="flex-1">{t(item.labelKey)}</span>}
      {item.useBadge && (
        <NavBadge useCount={item.useBadge} labelKey={item.labelKey} dot={collapsed} />
      )}
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
              {/* 收起來時以一個點提示裡面有待處理的項目；多個項目都有時 CSS 只留第一個點 */}
              {!open && (
                <span className={styles.dots}>
                  {group.items.map(
                    (item) =>
                      item.useBadge && (
                        <NavBadge
                          key={item.testId}
                          useCount={item.useBadge}
                          labelKey={item.labelKey}
                          dot
                        />
                      ),
                  )}
                </span>
              )}
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
