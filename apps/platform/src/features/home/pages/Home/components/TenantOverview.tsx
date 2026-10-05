import { Skeleton } from '@b2b-system/ui/Skeleton';
import { useTranslation } from '@b2b-system/web-core/locales';
import { cn } from '@b2b-system/web-shared/utils';
import { useQueries } from '@tanstack/react-query';

import { getTenantListQueryOptions } from '@/apis/platform-tenant/get-tenant-list/query';

import { TENANT_OVERVIEW_LABEL_KEY, TENANT_OVERVIEW_STATUSES } from '../../../constants';

/**
 * 各狀態的租戶數（`tenant:read`）。沿用租戶清單的端點、只取一筆，用回應的 `pagination.total`；
 * 失敗與佈建中不是 0 時以強調色標出，平台管理者一進來就知道有沒有要處理的租戶。
 */
export function TenantOverview() {
  const { t } = useTranslation();
  const counts = useQueries({
    queries: TENANT_OVERVIEW_STATUSES.map((status) =>
      getTenantListQueryOptions({ offset: 0, limit: 1, status }),
    ),
  });

  return (
    <section className="flex flex-col gap-3" data-testid="home-tenant-overview">
      <h2 className="m-0 text-base font-medium">{t('home.tenants.title')}</h2>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {TENANT_OVERVIEW_STATUSES.map((status, index) => {
          const total = counts[index]?.data?.pagination.total;
          const attention = status === 'failed' || status === 'provisioning';
          return (
            <div
              key={status}
              className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4"
              data-testid="home-tenant-count"
              data-value={status}
            >
              <p className="m-0 text-sm text-[var(--color-fg-muted)]">
                {t(TENANT_OVERVIEW_LABEL_KEY[status])}
              </p>
              {total === undefined ? (
                <Skeleton height={28} width={48} />
              ) : (
                <p
                  className={cn(
                    'm-0 mt-1 text-2xl font-semibold',
                    attention && total > 0 && 'text-[var(--color-danger-text)]',
                  )}
                >
                  {total}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
