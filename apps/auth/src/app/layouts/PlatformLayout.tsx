import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import { getAuthProfileQueryOptions } from '@/apis/auth/get-profile/query';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { Menu } from '@/components/Menu';
import { useHasSession } from '@/core/auth';
import { useTranslation } from '@/core/locales';
import { usePageAccessChecker } from '@/core/permission';
import type { PageKey } from '@/core/permission';
import { HOME_PAGE } from '@/features/home';
import { useLogoutMutation } from '@/features/login';
import { WORKSPACE_ADMIN_PAGE } from '@/features/workspace-admin';

import { ThemeMenu } from './ThemeMenu';

interface PlatformLayoutProps {
  children: ReactNode;
}

interface NavItem {
  pageKey: PageKey;
  to: string;
  labelKey: string;
  /** 完整字面量（docs/conventions/06-literal-strings.md §3.3） */
  testId: string;
}

/** `app/` 是唯一知道所有 feature 的地方。依頁面權限顯示（沒權限的不出現）。 */
const NAV: NavItem[] = [
  { pageKey: HOME_PAGE, to: '/', labelKey: 'menu.home', testId: 'menu-home' },
  {
    pageKey: WORKSPACE_ADMIN_PAGE,
    to: '/workspaces',
    labelKey: 'menu.workspace',
    testId: 'menu-workspace',
  },
];

/**
 * 平台頁面的外框：頂列（品牌、主題、帳號選單）＋ 內容。
 * 沒有工作區切換器：apps/auth 不分工作區（docs/adr/0019-sso-identity-platform.md D1）。
 */
export function PlatformLayout({ children }: PlatformLayoutProps) {
  const { t } = useTranslation();
  const hasSession = useHasSession();
  const profile = useQuery({ ...getAuthProfileQueryOptions(), enabled: hasSession });
  const logout = useLogoutMutation();
  const { hydrated, canAccessPage } = usePageAccessChecker();
  const nav = hydrated ? NAV.filter((item) => canAccessPage(item.pageKey)) : [];

  return (
    <div className="flex min-h-screen flex-col bg-[var(--color-bg)]">
      <header className="flex h-14 items-center gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4">
        <div className="flex flex-1 items-baseline gap-2">
          <span className="text-base font-semibold">{t('app.title')}</span>
          <span className="text-xs text-[var(--color-fg-muted)]">{t('app.platform')}</span>
          <nav className="ml-6 flex items-center gap-4 text-sm">
            {nav.map((item) => (
              <Link
                key={item.pageKey}
                to={item.to}
                className="text-[var(--color-fg-muted)] no-underline"
                activeProps={{ className: 'text-[var(--color-fg)] font-medium' }}
                activeOptions={{ exact: item.to === '/' }}
                data-testid={item.testId}
              >
                {t(item.labelKey)}
              </Link>
            ))}
          </nav>
        </div>
        <ThemeMenu />
        {profile.data && (
          <Menu
            align="end"
            trigger={
              <Button variant="ghost" size="sm" data-testid="account-menu-trigger">
                <Icon name="user" size={16} />
                <span>{profile.data.user.displayName}</span>
              </Button>
            }
            items={[
              {
                key: 'logout',
                label: t('menu.logout'),
                onSelect: () => logout.mutate(),
              },
            ]}
          />
        )}
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 p-6">{children}</main>
    </div>
  );
}
