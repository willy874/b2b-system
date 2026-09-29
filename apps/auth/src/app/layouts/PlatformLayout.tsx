import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { getAuthProfileQueryOptions } from '@/apis/auth/get-profile/query';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { Menu } from '@/components/Menu';
import { useHasSession } from '@/core/auth';
import { useTranslation } from '@/core/locales';
import { useLogoutMutation } from '@/features/login';

import { ThemeMenu } from './ThemeMenu';

interface PlatformLayoutProps {
  children: ReactNode;
}

/**
 * 平台頁面的外框：頂列（品牌、主題、帳號選單）＋ 內容。
 * 沒有工作區切換器：apps/auth 不分工作區（docs/adr/0019-sso-identity-platform.md D1）。
 */
export function PlatformLayout({ children }: PlatformLayoutProps) {
  const { t } = useTranslation();
  const hasSession = useHasSession();
  const profile = useQuery({ ...getAuthProfileQueryOptions(), enabled: hasSession });
  const logout = useLogoutMutation();

  return (
    <div className="flex min-h-screen flex-col bg-[var(--color-bg)]">
      <header className="flex h-14 items-center gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4">
        <div className="flex flex-1 items-baseline gap-2">
          <span className="text-base font-semibold">{t('app.title')}</span>
          <span className="text-xs text-[var(--color-fg-muted)]">{t('app.platform')}</span>
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
