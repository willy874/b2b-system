import { PageHeader } from '@b2b-system/ui/PageHeader';
import { Tabs } from '@b2b-system/ui/Tabs';
import { useTranslation } from '@b2b-system/web-core/locales';
import { useLocation, useNavigate } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import { useSystemSettingsTabs } from './useSystemSettingsTabs';

interface SystemSettingsLayoutProps {
  children: ReactNode;
}

/**
 * 系統設定的外框：標題與分頁列（docs/architecture/frontend/02-plugin-system.md §4.5）。
 * 每個分頁的頁面自己包一層，分頁的內容與權限仍由各自的 feature 決定。
 */
export function SystemSettingsLayout({ children }: SystemSettingsLayoutProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { tabs } = useSystemSettingsTabs();
  const current = tabs.find((tab) => pathname.startsWith(tab.to));

  return (
    <div className="flex flex-col gap-4" data-testid="system-settings-layout">
      <PageHeader title={t('menu.setting')} description={t('app.systemSettings.description')} />
      {tabs.length > 1 && current && (
        <Tabs
          value={current.to}
          onValueChange={(to) => void navigate({ to })}
          tabs={tabs.map((tab) => ({ value: tab.to, label: t(tab.labelKey) }))}
          moreLabel={t('common.more')}
          data-testid="system-settings-tabs"
        />
      )}
      {children}
    </div>
  );
}
