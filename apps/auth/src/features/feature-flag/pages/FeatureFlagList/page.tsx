import { useQuery } from '@tanstack/react-query';

import { getFeatureFlagListQueryOptions } from '@/apis/platform-feature-flag/get-feature-flag-list/query';
import { useTranslation } from '@/core/locales';

import { useFeatureFlagPermission } from '../../hooks/useFeatureFlagPermission';
import { FeatureFlagTable } from './components/FeatureFlagTable';

/** 平台管理者的試行開關：目錄、全平台狀態與覆寫它的租戶數（docs/adr/0022-feature-flags.md D8）。 */
export default function FeatureFlagListPage() {
  const { t } = useTranslation();
  const { canUpdate } = useFeatureFlagPermission();
  const { data, isPending } = useQuery(getFeatureFlagListQueryOptions());
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="flex flex-col gap-4" data-testid="feature-flag-page">
      <header>
        <h1 className="m-0 text-xl font-semibold">{t('featureFlag.title')}</h1>
        <p className="mt-1 text-sm text-[var(--color-fg-muted)]">{t('featureFlag.description')}</p>
      </header>
      <FeatureFlagTable
        items={data?.items ?? []}
        loading={isPending}
        canUpdate={canUpdate}
        today={today}
      />
    </div>
  );
}
