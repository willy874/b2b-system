import { useQuery } from '@tanstack/react-query';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import { useId, useState } from 'react';
import type { ReactNode } from 'react';

import { getAuthProfileQueryOptions } from '@/apis/auth/get-profile/query';
import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/Button';
import { IconButton } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { Menu } from '@/components/Menu';
import { useTranslation } from '@/core/locales';
import { useLayoutStore } from '@/core/store';
import { PREFERENCE_PAGE, PROFILE_PAGE } from '@/features/account';
import { useLogoutMutation } from '@/features/login';
import { useMediaQuery } from '@/shared/hooks';
import { cn } from '@/shared/utils';

import { HeaderToolbar } from './HeaderToolbar';
import { useMenuItems } from './menu';
import type { MenuItem } from './menu';
import { SidebarNav } from './SidebarNav';

import './DashboardLayout.css';

const ACCOUNT_MENU: MenuItem[] = [
  {
    pageKey: PROFILE_PAGE,
    to: '/profile',
    labelKey: 'menu.profile',
    icon: 'user',
  },
  {
    pageKey: PREFERENCE_PAGE,
    to: '/preference',
    labelKey: 'menu.preference',
    icon: 'settings',
  },
];

/** 與 DashboardLayout.css 的斷點一致：以下側欄改成覆蓋式抽屜。 */
const NARROW_QUERY = '(max-width: 767px)';

/**
 * 平台管理的外框，與 apps/backstage 的 `DashboardLayout` 相同的結構：可收合的分組側欄（窄螢幕是抽屜）、
 * 頂列工具（依偏好排序與隱藏）、帳號選單。品牌下方標示「平台」，而不是租戶名稱：
 * apps/platform 不屬於任何租戶（docs/architecture/05-tenancy.md §10.2 D2）。
 */
export function DashboardLayout({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const collapsed = useLayoutStore((state) => state.sidebarCollapsed);
  const toggleSidebar = useLayoutStore((state) => state.toggleSidebar);
  const narrow = useMediaQuery(NARROW_QUERY);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const accountItems = useMenuItems(ACCOUNT_MENU);
  const logout = useLogoutMutation();
  const profile = useQuery(getAuthProfileQueryOptions());
  const sidebarId = useId();

  // 換頁就收起抽屜（以「上一次看到的路徑」判斷，不用 effect 同步）
  const [seenPath, setSeenPath] = useState(pathname);
  if (seenPath !== pathname) {
    setSeenPath(pathname);
    setDrawerOpen(false);
  }

  // 窄螢幕：側欄是抽屜，不用「收合成圖示欄」
  const iconOnly = !narrow && collapsed;
  const sidebarExpanded = narrow ? drawerOpen : !collapsed;
  const userName = profile.data?.admin.displayName ?? '';

  return (
    <div
      className={cn(
        'ga-shell',
        iconOnly && 'ga-shell--collapsed',
        narrow && drawerOpen && 'ga-shell--drawer-open',
      )}
    >
      <aside id={sidebarId} className="ga-shell__sidebar" data-testid="sidebar">
        <div className="ga-shell__brand" title={iconOnly ? t('app.platform') : undefined}>
          {/* 品牌徽章取自產品名稱，與 backstage 一致 */}
          <span className="ga-shell__brand-mark" aria-hidden="true" data-testid="brand-mark">
            {t('app.mark')}
          </span>
          {!iconOnly && (
            <span className="ga-shell__brand-text">
              <span>{t('app.title')}</span>
              <span className="ga-shell__tenant" data-testid="current-realm">
                {t('app.platform')}
              </span>
            </span>
          )}
        </div>
        <SidebarNav collapsed={iconOnly} />
      </aside>
      {narrow && drawerOpen && (
        <button
          type="button"
          className="ga-shell__scrim"
          aria-label={t('layout.closeSidebar')}
          onClick={() => setDrawerOpen(false)}
          data-testid="sidebar-scrim"
        />
      )}

      <div className="ga-shell__main">
        <header className="ga-shell__topbar">
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
                <Avatar name={userName || '?'} size={24} />
                {userName && <span className="ga-shell__user-name">{userName}</span>}
              </Button>
            }
            items={[
              ...accountItems.map((item) => ({
                key: item.labelKey,
                label: t(item.labelKey),
                onSelect: () => void navigate({ to: item.to }),
              })),
              // 平台管理者也常要以租戶的身分看畫面：前往「進入租戶」輸入代碼（docs/architecture/05-tenancy.md §10.2 D11）
              {
                key: 'enterTenant',
                label: t('menu.enterTenant'),
                onSelect: () => void navigate({ to: '/enter' }),
              },
              {
                key: 'logout',
                label: t('menu.logout'),
                tone: 'danger' as const,
                onSelect: () => logout.mutate(),
              },
            ]}
          />
        </header>
        <main className="ga-shell__content">{children}</main>
      </div>
    </div>
  );
}
