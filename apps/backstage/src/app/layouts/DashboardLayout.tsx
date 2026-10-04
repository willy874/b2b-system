import { useQuery } from '@tanstack/react-query';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import { useId, useState } from 'react';
import type { ReactNode } from 'react';

import { getAuthProfileQueryOptions } from '@/apis/auth/get-profile/query';
import { getCurrentTenantQueryOptions } from '@/apis/tenant/get-current-tenant/query';
import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/Button';
import { IconButton } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { Menu } from '@/components/Menu';
import { BatchQueueNotifier } from '@/core/batch';
import { useIsFeatureReady } from '@/core/feature';
import { useTranslation } from '@/core/locales';
import { useLayoutStore } from '@/core/store';
import { PREFERENCE_PAGE, PROFILE_PAGE } from '@/features/account';
import { useLogoutMutation } from '@/features/auth';
import { ENV } from '@/shared/constants/env';
import { useMediaQuery } from '@/shared/hooks';
import { cn } from '@/shared/utils';

import { TENANT_SWITCH_FEATURE } from '../features';
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
 * 換租戶＝換網域：回到 apps/platform 的「進入租戶」輸入代碼（docs/architecture/05-tenancy.md §10.2 D11）。
 * 平台管理者可對租戶關閉這個項目（`tenantSwitch`，docs/architecture/05-tenancy.md §12.2 D6）。
 */
const SWITCH_TENANT_URL = `${ENV.PLATFORM_APP_URL}/enter`;

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
  const tenant = useQuery(getCurrentTenantQueryOptions());
  const sidebarId = useId();
  const canSwitchTenant = useIsFeatureReady(TENANT_SWITCH_FEATURE);

  // 換頁就收起抽屜（以「上一次看到的路徑」判斷，不用 effect 同步）
  const [seenPath, setSeenPath] = useState(pathname);
  if (seenPath !== pathname) {
    setSeenPath(pathname);
    setDrawerOpen(false);
  }

  // 窄螢幕：側欄是抽屜，不用「收合成圖示欄」
  const iconOnly = !narrow && collapsed;
  const sidebarExpanded = narrow ? drawerOpen : !collapsed;
  const userName = profile.data?.user.displayName ?? '';
  const tenantName = tenant.data?.name;

  return (
    <div
      className={cn(
        'ge-shell',
        iconOnly && 'ge-shell--collapsed',
        narrow && drawerOpen && 'ge-shell--drawer-open',
      )}
    >
      <aside id={sidebarId} className="ge-shell__sidebar" data-testid="sidebar">
        <div className="ge-shell__brand" title={iconOnly ? tenantName : undefined}>
          {/* 品牌徽章取自產品名稱而非租戶名稱：apps/platform 沒有租戶，兩邊才會一致；租戶名稱另外顯示在下方 */}
          <span className="ge-shell__brand-mark" aria-hidden="true" data-testid="brand-mark">
            {t('app.mark')}
          </span>
          {!iconOnly && (
            <span className="ge-shell__brand-text">
              <span>{t('app.title')}</span>
              {/* 目前在哪個租戶：同時管理多個租戶的人才不會在錯的地方刪人 */}
              {tenantName && (
                <span className="ge-shell__tenant" data-testid="current-tenant">
                  {tenantName}
                </span>
              )}
            </span>
          )}
        </div>
        <SidebarNav collapsed={iconOnly} />
      </aside>
      {narrow && drawerOpen && (
        <button
          type="button"
          className="ge-shell__scrim"
          aria-label={t('layout.closeSidebar')}
          onClick={() => setDrawerOpen(false)}
          data-testid="sidebar-scrim"
        />
      )}

      <div className="ge-shell__main">
        <header className="ge-shell__topbar">
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
                {userName && <span className="ge-shell__user-name">{userName}</span>}
              </Button>
            }
            items={[
              ...accountItems.map((item) => ({
                key: item.labelKey,
                label: t(item.labelKey),
                onSelect: () => void navigate({ to: item.to }),
              })),
              ...(canSwitchTenant
                ? [
                    {
                      key: 'switchTenant',
                      label: t('menu.switchTenant'),
                      onSelect: () => globalThis.location.assign(SWITCH_TENANT_URL),
                    },
                  ]
                : []),
              {
                key: 'logout',
                label: t('menu.logout'),
                tone: 'danger' as const,
                onSelect: () => logout.mutate(),
              },
            ]}
          />
        </header>
        <main className="ge-shell__content">{children}</main>
        {/* 批次工作結束時彈出結果（佇列只通知發起的分頁） */}
        <BatchQueueNotifier />
      </div>
    </div>
  );
}
