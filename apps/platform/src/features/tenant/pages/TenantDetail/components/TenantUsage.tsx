import { Progress } from '@b2b-system/ui/Progress';
import { Table } from '@b2b-system/ui/Table';
import type { TableColumnDef } from '@b2b-system/ui/Table';
import { PageSkeleton, QueryError } from '@b2b-system/web-core/components';
import { useTranslation } from '@b2b-system/web-core/locales';
import { formatDateTime } from '@b2b-system/web-shared/date';
import { formatBytes } from '@b2b-system/web-shared/utils';
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useMemo } from 'react';

import { getTenantUsageQueryOptions } from '@/apis/platform-tenant/get-tenant-usage/query';

import { toTenantUsageVM } from '../adapter';
import type { TenantUsageDayVM, TenantUsageSummaryVM } from '../adapter';

/** 趨勢看幾天（含今天）。 */
const TREND_DAYS = 30;

interface TenantUsageProps {
  tenantId: string;
}

/**
 * 用量分頁（docs/architecture/05-tenancy.md §5.4）：最近一次快照的摘要、儲存的配額使用率，
 * 與近 30 天每天的請求、背景工作、使用者、儲存量。快照每小時彙總一次。
 */
export function TenantUsage({ tenantId }: TenantUsageProps) {
  const { t } = useTranslation();
  const query = useQuery(getTenantUsageQueryOptions(tenantId, TREND_DAYS));
  const usage = useMemo(() => (query.data ? toTenantUsageVM(query.data) : undefined), [query.data]);

  if (query.isPending) return <PageSkeleton />;
  if (!usage) {
    return (
      <QueryError
        error={query.error}
        onRetry={() => void query.refetch()}
        data-testid="tenant-usage-error"
      />
    );
  }

  return (
    <div className="flex flex-col gap-4" data-testid="tenant-usage">
      <UsageSummary summary={usage.summary} />
      <section className="flex flex-col gap-2">
        <div>
          <h2 className="m-0 text-base font-semibold">
            {t('tenant.usage.trendTitle', { days: TREND_DAYS })}
          </h2>
          <p className="m-0 mt-1 text-xs text-[var(--color-fg-muted)]">
            {t('tenant.usage.trendHint')}
          </p>
        </div>
        <UsageTrend days={usage.days} />
      </section>
    </div>
  );
}

function UsageSummary({ summary }: { summary: TenantUsageSummaryVM }) {
  const { t } = useTranslation();
  return (
    <section className="flex flex-col gap-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <p className="m-0 text-xs text-[var(--color-fg-muted)]" data-testid="tenant-usage-snapshot">
        {summary.snapshotAt
          ? t('tenant.usage.snapshotAt', { time: formatDateTime(summary.snapshotAt) })
          : t('tenant.usage.noSnapshot')}
      </p>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(11rem,1fr))] gap-4">
        <Stat
          label={t('tenant.usage.usersActive')}
          value={summary.usersActive?.toLocaleString() ?? '-'}
          hint={
            summary.usersTotal === null
              ? undefined
              : t('tenant.usage.usersOf', { total: summary.usersTotal.toLocaleString() })
          }
          testId="tenant-usage-users"
        />
        <Stat
          label={t('tenant.usage.serviceAccounts')}
          value={summary.serviceAccounts?.toLocaleString() ?? '-'}
          testId="tenant-usage-service-accounts"
        />
        <Stat
          label={t('tenant.usage.recentRequests', { days: summary.recentDays })}
          value={summary.recentRequests.toLocaleString()}
          testId="tenant-usage-requests"
        />
        <Stat
          label={t('tenant.usage.lastActivityAt')}
          value={
            summary.lastActivityAt
              ? formatDateTime(summary.lastActivityAt)
              : t('tenant.usage.never')
          }
          testId="tenant-usage-last-activity"
        />
      </div>
      {summary.storageUsedBytes !== null && summary.storageQuotaBytes !== null && (
        <div className="flex flex-col gap-1">
          <Progress
            value={Math.min(summary.storageUsedBytes, summary.storageQuotaBytes)}
            max={summary.storageQuotaBytes}
            tone={summary.isStorageWarning ? 'danger' : 'brand'}
            label={t('tenant.usage.storage')}
            data-testid="tenant-usage-storage"
            data-value={summary.isStorageWarning ? 'warning' : 'normal'}
          />
          <p className="m-0 text-xs text-[var(--color-fg-muted)]">
            {/* 百分比與清單、警示、通知同一個算法（無條件捨去），不用 Progress 自己四捨五入的值 */}
            {t('tenant.usage.storageOf', {
              used: formatBytes(summary.storageUsedBytes),
              quota: formatBytes(summary.storageQuotaBytes),
              percent: summary.storagePercent,
            })}
          </p>
          {summary.isStorageWarning && (
            <p
              className="m-0 text-sm text-[var(--color-warning-text)]"
              data-testid="tenant-usage-storage-warning"
            >
              {t('tenant.usage.storageWarning', { percent: summary.storagePercent })}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

interface StatProps {
  label: string;
  value: ReactNode;
  hint?: string;
  testId: string;
}

function Stat({ label, value, hint, testId }: StatProps) {
  return (
    <div className="flex flex-col gap-1" data-testid={testId}>
      <span className="text-xs text-[var(--color-fg-muted)]">{label}</span>
      <span className="text-lg font-semibold tabular-nums">{value}</span>
      {hint && <span className="text-xs text-[var(--color-fg-muted)]">{hint}</span>}
    </div>
  );
}

function UsageTrend({ days }: { days: TenantUsageDayVM[] }) {
  const { t } = useTranslation();
  const columns = useMemo<Array<TableColumnDef<TenantUsageDayVM>>>(
    () => [
      {
        id: 'date',
        header: t('tenant.usage.column.date'),
        cell: ({ row }) => <span className="font-mono text-xs">{row.original.date}</span>,
      },
      {
        id: 'requestsInternal',
        header: t('tenant.usage.column.requestsInternal'),
        cell: ({ row }) => (
          <span className="flex items-center gap-2 tabular-nums">
            {/* 長條是當天的請求合計（後台 ＋ 對外 API）相對於區間內最多的那一天 */}
            <span
              aria-hidden
              className="h-2 rounded-full bg-[var(--color-brand)]"
              style={{ width: `${row.original.requestsShare * 4}rem` }}
            />
            {row.original.requestsInternal.toLocaleString()}
          </span>
        ),
      },
      {
        id: 'requestsExternal',
        header: t('tenant.usage.column.requestsExternal'),
        cell: ({ row }) => row.original.requestsExternal.toLocaleString(),
      },
      {
        id: 'jobsExecuted',
        header: t('tenant.usage.column.jobsExecuted'),
        cell: ({ row }) => row.original.jobsExecuted.toLocaleString(),
      },
      {
        id: 'usersActive',
        header: t('tenant.usage.column.usersActive'),
        cell: ({ row }) => row.original.usersActive?.toLocaleString() ?? '-',
      },
      {
        id: 'storage',
        header: t('tenant.usage.column.storage'),
        cell: ({ row }) =>
          row.original.storageUsedBytes === null ? '-' : formatBytes(row.original.storageUsedBytes),
      },
    ],
    [t],
  );
  return (
    <Table
      data={days}
      columns={columns}
      getRowId={getDayId}
      stickyHeader
      data-testid="tenant-usage-trend"
    />
  );
}

const getDayId = (day: TenantUsageDayVM) => day.date;
