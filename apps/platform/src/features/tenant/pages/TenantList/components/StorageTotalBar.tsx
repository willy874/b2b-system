import { Progress } from '@b2b-system/ui/Progress';
import { useTranslation } from '@b2b-system/web-core/locales';
import { formatDateTime } from '@b2b-system/web-shared/date';
import { formatBytes } from '@b2b-system/web-shared/utils';

import type { StorageTotalVM } from '../adapter';

interface StorageTotalBarProps {
  total: StorageTotalVM;
}

/**
 * 所有租戶的已用量合計與儲存的止水線（docs/architecture/backend/25-image.md §12 D8）。
 * 已達止水線時所有租戶都無法上傳；彙總太久沒更新時止水線暫時不擋，兩者都要讓平台管理者看到。
 */
export function StorageTotalBar({ total }: StorageTotalBarProps) {
  const { t } = useTranslation();
  return (
    <section className="flex flex-col gap-1" data-testid="tenant-storage-total">
      <Progress
        value={Math.min(total.usedBytes, total.limitBytes)}
        max={total.limitBytes}
        tone={total.isWarning ? 'danger' : 'brand'}
        label={t('tenant.storageTotal.title')}
        data-testid="tenant-storage-total-progress"
        data-value={total.isReached ? 'reached' : total.isWarning ? 'warning' : 'normal'}
      />
      <p className="m-0 text-xs text-[var(--color-fg-muted)]">
        {t('tenant.storageTotal.usedOf', {
          used: formatBytes(total.usedBytes),
          limit: formatBytes(total.limitBytes),
          percent: total.percent,
        })}
        {total.measuredAt &&
          ` · ${t('tenant.storageTotal.measuredAt', { time: formatDateTime(total.measuredAt) })}`}
      </p>
      {total.isReached ? (
        <p
          className="m-0 text-sm text-[var(--color-danger-text)]"
          data-testid="tenant-storage-total-reached"
        >
          {t('tenant.storageTotal.reached')}
        </p>
      ) : (
        total.isWarning && (
          <p
            className="m-0 text-sm text-[var(--color-warning-text)]"
            data-testid="tenant-storage-total-warning"
          >
            {t('tenant.storageTotal.warning', { percent: total.percent })}
          </p>
        )
      )}
      {total.isStale && (
        <p
          className="m-0 text-sm text-[var(--color-warning-text)]"
          data-testid="tenant-storage-total-stale"
        >
          {t('tenant.storageTotal.stale')}
        </p>
      )}
    </section>
  );
}
