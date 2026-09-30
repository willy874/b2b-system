import { useNavigate } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/Button';
import { IconButton } from '@/components/Button';
import { Menu } from '@/components/Menu';
import { BatchQueueIndicator, BatchQueueNotifier } from '@/core/batch';
import { useTranslation } from '@/core/locales';
import { useLayoutStore } from '@/core/store';
import { PREFERENCE_PAGE, PROFILE_PAGE } from '@/features/account';
import { useLogoutMutation } from '@/features/auth';
import { cn } from '@/shared/utils';

import { useMenuItems } from './menu';
import type { MenuItem } from './menu';
import { SidebarNav } from './SidebarNav';
import { ThemeMenu } from './ThemeMenu';

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

export function DashboardLayout({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const collapsed = useLayoutStore((state) => state.sidebarCollapsed);
  const toggleSidebar = useLayoutStore((state) => state.toggleSidebar);
  const accountItems = useMenuItems(ACCOUNT_MENU);
  const logout = useLogoutMutation();

  return (
    <div className={cn('ge-shell', collapsed && 'ge-shell--collapsed')}>
      <aside className="ge-shell__sidebar" data-testid="sidebar">
        <div className="ge-shell__brand">
          <span className="ge-shell__brand-mark">GE</span>
          {!collapsed && <span>{t('app.title')}</span>}
        </div>
        <SidebarNav collapsed={collapsed} />
      </aside>

      <div className="ge-shell__main">
        <header className="ge-shell__topbar">
          <IconButton
            aria-label="toggle sidebar"
            onClick={toggleSidebar}
            data-testid="sidebar-toggle"
          >
            ☰
          </IconButton>
          <div className="flex-1" />
          <BatchQueueIndicator />
          <ThemeMenu />
          <Menu
            trigger={
              <Button variant="ghost" data-testid="account-menu-trigger">
                <Avatar name="Me" size={24} />
              </Button>
            }
            items={[
              ...accountItems.map((item) => ({
                key: item.labelKey,
                label: t(item.labelKey),
                onSelect: () => void navigate({ to: item.to }),
              })),
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
