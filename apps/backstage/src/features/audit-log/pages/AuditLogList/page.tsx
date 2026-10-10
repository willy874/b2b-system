import { PageHeader } from '@b2b-system/ui/PageHeader';
import { AuditLogTable } from '@b2b-system/web-core/audit-log';
import type { AuditLogRowVM } from '@b2b-system/web-core/audit-log';
import type { TableSettingsConfig } from '@b2b-system/web-core/components';
import { ExportDialog } from '@b2b-system/web-core/data-transfer';
import { useTranslation } from '@b2b-system/web-core/locales';
import { zonedDayBoundary } from '@b2b-system/web-shared/date';
import { useSingleExpanded } from '@b2b-system/web-shared/hooks';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';

import { getAuditLogListQueryOptions } from '@/apis/audit-log/get-audit-log-list/query';
import { TransferActions } from '@/core/components/TransferActions';
import { useIsFeatureReady } from '@/core/feature';
import { PermissionKey, usePermission } from '@/core/permission';
import { TenantFeature } from '@/shared/api-sdk';

import { AUDIT_LOG_COUNT_CAP, AUDIT_LOG_MAX_RANGE_DAYS } from '../../constants';
import { auditLogExportApi } from '../../hooks/auditLogExportApi';
import { AUDIT_LOG_LIST_DEFAULT_HIDDEN, AUDIT_LOG_LIST_TABLE_ID } from '../../preference';
import { toAuditLogRowVM } from './adapter';
import { AuditLogDetail } from './components/AuditLogDetail';
import { useAuditLogCursor } from './useAuditLogCursor';
import { useAuditLogFilters } from './useAuditLogFilters';
import { useAuditLogSearchFilter } from './useAuditLogSearchFilter';

/** 欄位順序與顯示存在這台裝置；可設定的欄位登記在 `preference.ts`。 */
const AUDIT_LOG_TABLE_SETTINGS: TableSettingsConfig = {
  tableId: AUDIT_LOG_LIST_TABLE_ID,
  defaultHidden: AUDIT_LOG_LIST_DEFAULT_HIDDEN,
};

/** 展開列的內容：明細在展開當下才向後端取（`AuditLogDetail`）。 */
const renderDetail = (row: AuditLogRowVM) => <AuditLogDetail id={row.id} />;

export default function AuditLogListPage() {
  const { t } = useTranslation();
  const searchFilter = useAuditLogSearchFilter();
  const { search, setPage } = searchFilter;
  const filters = useAuditLogFilters(searchFilter);
  const { expandedId: expanded, onToggleExpand: toggleExpand } = useSingleExpanded();
  const [exporting, setExporting] = useState(false);
  const { can, hydrated } = usePermission();
  const hasDataTransfer = useIsFeatureReady(TenantFeature.dataTransfer);
  // 匯出要獨立的 auditLog:export（docs/architecture/backend/22-data-transfer.md §13 D11）
  const canExport = hydrated && hasDataTransfer && can(PermissionKey['auditLog:export']);

  // 篩選條件或每頁筆數改變：記下的游標全部作廢
  const cursorScope = JSON.stringify([
    search.limit,
    search.action,
    search.resourceType,
    search.result,
    search.from,
    search.to,
  ]);
  const { cursor, remember } = useAuditLogCursor(cursorScope, search.offset, search.limit);

  // 列表與匯出共用的篩選條件（匯出的就是列表 API 的同一個物件，去掉分頁）
  const filter = useMemo(
    () => ({
      action: search.action,
      resourceType: search.resourceType,
      result: search.result,
      // 網址上的日期是使用者當地的日曆日：起日取當天 00:00、迄日取 23:59:59
      // 日界線用偏好的時區，與列表顯示的時間一致
      from: search.from ? zonedDayBoundary(search.from, 'start') : undefined,
      to: search.to ? zonedDayBoundary(search.to, 'end') : undefined,
    }),
    [search.action, search.from, search.resourceType, search.result, search.to],
  );
  const { data, isPending, isPlaceholderData, error, refetch } = useQuery(
    getAuditLogListQueryOptions({
      params: { offset: search.offset, cursor, limit: search.limit, ...filter },
    }),
  );

  // 佔位資料是上一頁的：它的 nextCursor 不屬於這一頁
  useEffect(() => {
    if (data && !isPlaceholderData) remember(search.offset, data.nextCursor);
  }, [data, isPlaceholderData, remember, search.offset]);

  const rows = useMemo(() => (data?.items ?? []).map(toAuditLogRowVM), [data]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4" data-testid="audit-log-page">
      <PageHeader
        title={t('auditLog.title')}
        description={t('auditLog.description', { days: AUDIT_LOG_MAX_RANGE_DAYS })}
        actions={
          <TransferActions
            exports={canExport ? [{ key: 'auditLog', onSelect: () => setExporting(true) }] : []}
            testIds={{ exportButton: 'audit-log-export-button' }}
          />
        }
      />

      <ExportDialog
        open={exporting}
        onOpenChange={setExporting}
        api={auditLogExportApi}
        type="auditLog"
        filter={filter}
        matchingTotal={data?.pagination.total ?? 0}
        data-testid="audit-log-export-dialog"
      />

      <AuditLogTable
        items={rows}
        loading={isPending}
        error={error}
        onRetry={() => void refetch()}
        expandedId={expanded}
        onToggleExpand={toggleExpand}
        settings={AUDIT_LOG_TABLE_SETTINGS}
        renderDetail={renderDetail}
        filters={filters}
        pagination={{
          offset: search.offset,
          limit: search.limit,
          total: data?.pagination.total ?? 0,
          totalCapped: (data?.pagination.total ?? 0) >= AUDIT_LOG_COUNT_CAP,
          pageSizeOptions: [25, 50, 100],
          onChange: ({ offset, limit }) => setPage(offset, limit),
        }}
      />
    </div>
  );
}
