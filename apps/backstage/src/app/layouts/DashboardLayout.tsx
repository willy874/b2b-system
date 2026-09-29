import { Link, useNavigate, useRouterState } from '@tanstack/react-router';
import { useMemo } from 'react';
import type { ReactNode } from 'react';

import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/Button';
import { IconButton } from '@/components/Button';
import { Icon } from '@/components/Icon';
import type { IconName } from '@/components/Icon';
import { Menu } from '@/components/Menu';
import { BatchQueueIndicator, BatchQueueNotifier } from '@/core/batch';
import { useTranslation } from '@/core/locales';
import { usePageAccessChecker } from '@/core/permission';
import type { PageKey } from '@/core/permission';
import { useLayoutStore } from '@/core/store';
import { PREFERENCE_PAGE, PROFILE_PAGE } from '@/features/account';
import { APPROVAL_PAGE } from '@/features/approval';
import { AUDIT_LOG_PAGE } from '@/features/audit-log';
import { useLogoutMutation } from '@/features/auth';
import { FILE_PAGE } from '@/features/file';
import { HOME_PAGE } from '@/features/home';
import { IDENTITY_PROVIDER_PAGE } from '@/features/identity-provider';
import { JOB_PAGE } from '@/features/job';
import { PERMISSION_PAGE } from '@/features/permission';
import { ROLE_PAGE } from '@/features/role';
import { USER_PAGE } from '@/features/user';
import { cn } from '@/shared/utils';

import { ThemeMenu } from './ThemeMenu';

import './DashboardLayout.css';

interface MenuItem {
  pageKey: PageKey;
  to: string;
  labelKey: string;
  icon: IconName;
}

interface NavItem extends MenuItem {
  /** 完整字面量（docs/conventions/06-literal-strings.md §3.3），E2E 以此定位側邊選單項 */
  testId: string;
}

/** `app/` 是唯一知道所有 feature 的地方，這是組裝層的本分。 */
const MENU: NavItem[] = [
  { pageKey: HOME_PAGE, to: '/', labelKey: 'menu.home', testId: 'menu-home', icon: 'home' },
  { pageKey: USER_PAGE, to: '/user', labelKey: 'menu.user', testId: 'menu-user', icon: 'users' },
  { pageKey: ROLE_PAGE, to: '/role', labelKey: 'menu.role', testId: 'menu-role', icon: 'shield' },
  {
    pageKey: PERMISSION_PAGE,
    to: '/permission',
    labelKey: 'menu.permission',
    testId: 'menu-permission',
    icon: 'key',
  },
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
  { pageKey: FILE_PAGE, to: '/file', labelKey: 'menu.file', testId: 'menu-file', icon: 'file' },
  { pageKey: JOB_PAGE, to: '/job', labelKey: 'menu.job', testId: 'menu-job', icon: 'monitor' },
  {
    pageKey: IDENTITY_PROVIDER_PAGE,
    to: '/identity-provider',
    labelKey: 'menu.identityProvider',
    testId: 'menu-identity-provider',
    icon: 'key',
  },
];

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

function useMenuItems<T extends MenuItem>(items: T[]): T[] {
  const { hydrated, canAccessPage } = usePageAccessChecker();
  // 未水合時回空陣列，而不是顯示全部再消失
  return useMemo(
    () => (hydrated ? items.filter((item) => canAccessPage(item.pageKey)) : []),
    [canAccessPage, hydrated, items],
  );
}

export function DashboardLayout({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const collapsed = useLayoutStore((state) => state.sidebarCollapsed);
  const toggleSidebar = useLayoutStore((state) => state.toggleSidebar);
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const items = useMenuItems(MENU);
  const accountItems = useMenuItems(ACCOUNT_MENU);
  const logout = useLogoutMutation();

  return (
    <div className={cn('ge-shell', collapsed && 'ge-shell--collapsed')}>
      <aside className="ge-shell__sidebar" data-testid="sidebar">
        <div className="ge-shell__brand">
          <span className="ge-shell__brand-mark">GE</span>
          {!collapsed && <span>{t('app.title')}</span>}
        </div>
        <nav className="ge-shell__nav">
          {items.map((item) => (
            <Link
              key={item.testId}
              to={item.to}
              className={cn(
                'ge-shell__nav-item',
                (pathname === item.to || (item.to !== '/' && pathname.startsWith(`${item.to}/`))) &&
                  'ge-shell__nav-item--active',
              )}
              data-testid={item.testId}
              title={collapsed ? t(item.labelKey) : undefined}
            >
              <Icon name={item.icon} size={16} />
              {!collapsed && <span>{t(item.labelKey)}</span>}
            </Link>
          ))}
        </nav>
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
