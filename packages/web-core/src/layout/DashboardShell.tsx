import { Button, IconButton } from '@b2b-system/ui/Button';
import { Icon } from '@b2b-system/ui/Icon';
import { Menu } from '@b2b-system/ui/Menu';
import type { MenuItemDescriptor } from '@b2b-system/ui/Menu';
import { useMediaQuery } from '@b2b-system/web-shared/hooks';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import { useId, useState } from 'react';
import type { ReactNode } from 'react';

import { CommandPalette, useRecentPageTracker } from '../command-palette';
import { useGlobalHotkeys } from '../hotkey';
import { SignedAvatar } from '../image';
import type { ImageSources } from '../image';
import { useTranslation } from '../locales';
import { useNavigation } from '../navigation';
import { useLayoutStore } from '../store';
import { HeaderToolbar } from './HeaderToolbar';
import { useMenuItems } from './menu';
import { SideNav } from './SideNav';

import styles from './DashboardShell.module.css';

/** 與 DashboardShell.module.css 的斷點一致：以下側欄改成覆蓋式抽屜。 */
const NARROW_QUERY = '(max-width: 767px)';

export interface DashboardBrand {
  /** 徽章上的縮寫（各 app 的 `app.mark`）。 */
  mark: string;
  /** 產品名（各 app 的 `app.title`）。 */
  name: string;
  /**
   * 產品名下方的一行，例：backstage 的目前租戶、apps/platform 的「平台」。
   * 收合成圖示欄時改當品牌區的 `title`。`testId` 是完整字面量。
   */
  context?: { label: string; testId: string };
}

export interface DashboardShellProps {
  brand: DashboardBrand;
  /** 帳號選單按鈕上的名稱。 */
  userName: string;
  /**
   * 帳號選單按鈕上的頭像（api 回應裡的 `ImageSources`，docs/architecture/backend/25-image.md §15.8）；沒有時顯示名字縮寫。
   * apps/platform 的平台管理者沒有頭像，不傳。
   */
  userAvatar?: ImageSources | null;
  /** 頭像的網址過期時重抓（見 `SignedImage` 的 `onExpired`）。 */
  onUserAvatarExpired?: () => void;
  /** 帳號選單裡接在頁面之後的項目（例：切換租戶、登出）。 */
  accountActions: MenuItemDescriptor[];
  /** 主內容之後的元素（例：backstage 的批次結果彈出）。 */
  afterContent?: ReactNode;
  children: ReactNode;
}

/**
 * 登入後的外框（兩個 app 共用）：可收合的分組側欄（窄螢幕是抽屜）、頂列工具（依偏好排序與隱藏）、帳號選單、
 * 命令面板（⌘K）與全域快捷鍵。側欄與帳號選單的頁面來自選單註冊表（`registerNavItem`）；
 * 品牌與帳號選單的其他項目由 app 的 `app/layouts/DashboardLayout.tsx` 傳入。
 */
export function DashboardShell({
  brand,
  userName,
  userAvatar,
  onUserAvatarExpired,
  accountActions,
  afterContent,
  children,
}: DashboardShellProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const collapsed = useLayoutStore((state) => state.sidebarCollapsed);
  const toggleSidebar = useLayoutStore((state) => state.toggleSidebar);
  const narrow = useMediaQuery(NARROW_QUERY);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const navigation = useNavigation();
  const accountItems = useMenuItems(navigation.accountItems);
  const sidebarId = useId();
  useGlobalHotkeys();
  useRecentPageTracker();

  // 換頁就收起抽屜（以「上一次看到的路徑」判斷，不用 effect 同步）
  const [seenPath, setSeenPath] = useState(pathname);
  if (seenPath !== pathname) {
    setSeenPath(pathname);
    setDrawerOpen(false);
  }

  // 窄螢幕：側欄是抽屜，不用「收合成圖示欄」
  const iconOnly = !narrow && collapsed;
  const sidebarExpanded = narrow ? drawerOpen : !collapsed;

  return (
    <div
      className={styles.shell}
      data-collapsed={iconOnly || undefined}
      data-drawer-open={(narrow && drawerOpen) || undefined}
    >
      <aside id={sidebarId} className={styles.sidebar} data-testid="sidebar">
        <div className={styles.brand} title={iconOnly ? brand.context?.label : undefined}>
          <span className={styles.brandMark} aria-hidden="true" data-testid="brand-mark">
            {brand.mark}
          </span>
          {!iconOnly && (
            <span className={styles.brandText}>
              <span>{brand.name}</span>
              {brand.context && (
                <span className={styles.brandContext} data-testid={brand.context.testId}>
                  {brand.context.label}
                </span>
              )}
            </span>
          )}
        </div>
        <SideNav topItems={navigation.topItems} groups={navigation.groups} collapsed={iconOnly} />
      </aside>
      {narrow && drawerOpen && (
        <button
          type="button"
          className={styles.scrim}
          aria-label={t('layout.closeSidebar')}
          onClick={() => setDrawerOpen(false)}
          data-testid="sidebar-scrim"
        />
      )}

      <div className={styles.main}>
        <header className={styles.topbar}>
          <IconButton
            aria-label={t('layout.toggleSidebar')}
            aria-expanded={sidebarExpanded}
            aria-controls={sidebarId}
            onClick={() => (narrow ? setDrawerOpen((open) => !open) : toggleSidebar())}
            data-testid="sidebar-toggle"
          >
            <Icon name="menu" size={20} />
          </IconButton>
          <HeaderToolbar />
          <Menu
            trigger={
              <Button
                variant="ghost"
                aria-label={t('layout.accountMenu', { name: userName })}
                data-testid="account-menu-trigger"
              >
                <SignedAvatar
                  sources={userAvatar}
                  variant="sm"
                  name={userName || '?'}
                  size={24}
                  onExpired={onUserAvatarExpired}
                />
                {userName && <span className={styles.userName}>{userName}</span>}
              </Button>
            }
            items={[
              ...accountItems.map((item) => ({
                key: item.labelKey,
                label: t(item.labelKey),
                onSelect: () => void navigate({ to: item.to }),
              })),
              ...accountActions,
            ]}
          />
        </header>
        <main className={styles.content}>{children}</main>
        {afterContent}
      </div>
      <CommandPalette />
    </div>
  );
}
