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
import { PermissionKey, usePageAccessChecker, usePermission } from '@/core/permission';
import type { PageKey } from '@/core/permission';
import { useLayoutStore } from '@/core/store';
import { useCurrentWorkspace } from '@/core/workspace';
import { PREFERENCE_PAGE, PROFILE_PAGE } from '@/features/account';
import { APPROVAL_PAGE } from '@/features/approval';
import { AUDIT_LOG_PAGE } from '@/features/audit-log';
import { useLogoutMutation } from '@/features/auth';
import { FILE_PAGE } from '@/features/file';
import { HOME_PAGE } from '@/features/home';
import { JOB_PAGE } from '@/features/job';
import { PERMISSION_PAGE } from '@/features/permission';
import { ROLE_PAGE } from '@/features/role';
import { USER_PAGE } from '@/features/user';
import {
  useDefaultWorkspaceSlug,
  WORKSPACE_MEMBER_PAGE,
  WorkspaceSwitcher,
} from '@/features/workspace';
import { ENV } from '@/shared/constants';
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

/**
 * 在另一個 app 的頁面（例：apps/auth 的租戶管理）：以一般連結頂層跳轉，不走 router。
 * backstage 沒有這個頁面、也沒有頁面權限可以註冊，所以直接依權限鍵決定要不要顯示。
 */
interface ExternalNavItem {
  href: string;
  permission: PermissionKey;
  labelKey: string;
  testId: string;
  icon: IconName;
}

/** 工作區裡的頁面：`to` 是工作區底下的相對路徑，實際連結帶上目前（或最近）的工作區。 */
interface WorkspaceNavItem extends NavItem {
  workspacePath: string;
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
  { pageKey: JOB_PAGE, to: '/job', labelKey: 'menu.job', testId: 'menu-job', icon: 'monitor' },
];

const EXTERNAL_MENU: ExternalNavItem[] = [
  {
    // 平台的租戶管理在 apps/auth（docs/adr/0019-sso-identity-platform.md D13）
    href: `${ENV.AUTH_APP_URL}/workspaces`,
    permission: PermissionKey['workspace:read'],
    labelKey: 'menu.workspace',
    testId: 'menu-workspace',
    icon: 'grid',
  },
];

/** 工作區頁面（docs/adr/0018-workspace-tenancy.md D17）；權限以目前工作區的權限判斷。 */
const WORKSPACE_MENU: WorkspaceNavItem[] = [
  {
    pageKey: FILE_PAGE,
    to: '',
    workspacePath: 'file',
    labelKey: 'menu.file',
    testId: 'menu-file',
    icon: 'file',
  },
  {
    pageKey: WORKSPACE_MEMBER_PAGE,
    to: '',
    workspacePath: 'members',
    labelKey: 'menu.workspaceMember',
    testId: 'menu-workspaceMember',
    icon: 'users',
  },
];

/** 不在工作區頁面時從切換器選了工作區：進到它的檔案管理器。 */
const workspaceHome = (slug: string) => `/w/${slug}/file`;

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

/**
 * 工作區頁面的選單：在工作區裡時以目前工作區的權限過濾；不在工作區裡時（還沒載入那個工作區的權限）
 * 先都列出，點進去由工作區版面判斷。還不屬於任何工作區時不列。
 */
function useWorkspaceMenuItems(items: WorkspaceNavItem[]): WorkspaceNavItem[] {
  const slug = useDefaultWorkspaceSlug();
  const current = useCurrentWorkspace();
  const { canAccessPage } = usePageAccessChecker();
  return useMemo(() => {
    if (!slug) return [];
    return items
      .filter((item) => !current || canAccessPage(item.pageKey))
      .map((item) => ({ ...item, to: `/w/${slug}/${item.workspacePath}` }));
  }, [canAccessPage, current, items, slug]);
}

function useExternalMenuItems(items: ExternalNavItem[]): ExternalNavItem[] {
  const { hydrated, can } = usePermission();
  return useMemo(
    () => (hydrated ? items.filter((item) => can(item.permission)) : []),
    [can, hydrated, items],
  );
}

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
  const items: Array<NavItem | ExternalNavItem> = [
    ...useMenuItems(MENU),
    ...useExternalMenuItems(EXTERNAL_MENU),
    ...useWorkspaceMenuItems(WORKSPACE_MENU),
  ];
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
          {items.map((item) =>
            'href' in item ? (
              <a
                key={item.testId}
                href={item.href}
                className="ge-shell__nav-item"
                data-testid={item.testId}
                title={collapsed ? t(item.labelKey) : undefined}
              >
                <Icon name={item.icon} size={16} />
                {!collapsed && <span>{t(item.labelKey)}</span>}
              </a>
            ) : (
              <Link
                key={item.testId}
                to={item.to}
                className={cn(
                  'ge-shell__nav-item',
                  (pathname === item.to ||
                    (item.to !== '/' && pathname.startsWith(`${item.to}/`))) &&
                    'ge-shell__nav-item--active',
                )}
                data-testid={item.testId}
                title={collapsed ? t(item.labelKey) : undefined}
              >
                <Icon name={item.icon} size={16} />
                {!collapsed && <span>{t(item.labelKey)}</span>}
              </Link>
            ),
          )}
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
          <WorkspaceSwitcher targetPathOf={workspaceHome} />
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
