import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { getSettingListQueryOptions } from '@/apis/system/get-setting-list/query';
import { Skeleton } from '@/components/Skeleton';
import { useTranslation } from '@/core/locales';

import { useSettingPermission } from '../../hooks/useSettingPermission';
import { toSettingCategories } from './adapter';
import { SettingCategoryForm } from './components/SettingCategoryForm';

/**
 * 系統設定（docs/architecture/backend/12-settings.md）：依分類列出執行期可調的設定。
 * 範圍由後端的定義決定，這裡只先擋明顯超出範圍的值；沒有 `system:update` 時唯讀。
 */
export default function SettingListPage() {
  const { t } = useTranslation();
  const permission = useSettingPermission();
  const { data, isPending } = useQuery(getSettingListQueryOptions());
  const categories = useMemo(() => toSettingCategories(data?.items ?? []), [data]);
  // 權限未水合前一律唯讀，避免輸入框先可編輯再變成唯讀
  const canUpdate = permission.hydrated && permission.canUpdate;

  return (
    <div className="flex max-w-3xl flex-col gap-4" data-testid="setting-page">
      <header>
        <h1 className="m-0 text-xl font-semibold">{t('setting.title')}</h1>
        <p className="mt-1 text-sm text-[var(--color-fg-muted)]">{t('setting.description')}</p>
      </header>
      {isPending ? (
        <Skeleton className="h-40" />
      ) : (
        categories.map((view) => (
          <SettingCategoryForm key={view.category} view={view} canUpdate={canUpdate} />
        ))
      )}
    </div>
  );
}
