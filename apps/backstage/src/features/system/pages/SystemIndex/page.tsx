import { Empty } from '@b2b-system/ui/Empty';
import { Skeleton } from '@b2b-system/ui/Skeleton';
import { useTranslation } from '@b2b-system/web-core/locales';
import { useStore } from '@b2b-system/web-shared/hooks';
import { useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';

import { featureStore } from '@/core/feature';
import { SystemSettingsLayout, useSystemSettingsTabs } from '@/core/system-settings';

/**
 * `/system`：導向第一個看得到的分頁。等權限與租戶的 feature 清單都到了才決定，
 * 否則「一般」分頁（可關閉的 feature）還沒安裝時會先被導到第二個分頁。
 */
export default function SystemIndexPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { hydrated, tabs } = useSystemSettingsTabs();
  const featuresResolved = useStore(featureStore, (state) => state.resolved);
  const first = hydrated && featuresResolved ? tabs[0] : undefined;

  useEffect(() => {
    if (first) void navigate({ to: first.to, replace: true });
  }, [first, navigate]);

  return (
    <SystemSettingsLayout>
      {hydrated && featuresResolved && tabs.length === 0 ? (
        <Empty title={t('app.systemSettings.empty')} data-testid="system-settings-empty" />
      ) : (
        <Skeleton className="h-40" />
      )}
    </SystemSettingsLayout>
  );
}
