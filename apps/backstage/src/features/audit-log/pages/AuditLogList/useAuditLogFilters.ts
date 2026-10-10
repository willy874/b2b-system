import { formatDate } from '@b2b-system/ui/DatePicker';
import type { DateRangeFilterValue, FilterBarProps } from '@b2b-system/web-core/components';
import { useTranslation } from '@b2b-system/web-core/locales';
import dayjs from 'dayjs';

import { useFeatureReadiness } from '@/core/feature';
import { TenantFeature } from '@/shared/api-sdk';

import { AUDIT_LOG_MAX_RANGE_DAYS } from '../../constants';
import type { AuditLogSearchQuery } from '../../routes';
import type { useAuditLogSearchFilter } from './useAuditLogSearchFilter';

export type AuditLogFilterValues = Pick<
  AuditLogSearchQuery,
  'action' | 'resourceType' | 'result'
> & {
  /** 網址上是 `from` / `to` 兩個參數，面板裡合成一個日期區間欄位。 */
  range?: DateRangeFilterValue;
};

const EMPTY_FILTERS: AuditLogFilterValues = {
  action: undefined,
  resourceType: undefined,
  result: undefined,
  range: undefined,
};

/**
 * 資源的選項與它屬於哪個可啟用的 feature（`null`：常駐）。平台沒有啟用的 feature 的資源不列出
 * （docs/architecture/frontend/02-plugin-system.md §7）；新增選項時一定要決定它屬於誰。
 */
const RESOURCE_OPTIONS: ReadonlyArray<{
  value: string;
  labelKey: string;
  feature: TenantFeature | null;
}> = [
  { value: 'user', labelKey: 'permission.resource.user', feature: null },
  { value: 'role', labelKey: 'permission.resource.role', feature: null },
  { value: 'approval', labelKey: 'permission.resource.approval', feature: null },
  { value: 'file', labelKey: 'permission.resource.file', feature: TenantFeature.file },
  { value: 'auth', labelKey: 'auditLog.resource.auth', feature: null },
  { value: 'authz', labelKey: 'auditLog.resource.authz', feature: null },
  {
    value: 'serviceAccount',
    labelKey: 'permission.resource.serviceAccount',
    feature: TenantFeature.externalApi,
  },
  { value: 'apiToken', labelKey: 'auditLog.resource.apiToken', feature: TenantFeature.externalApi },
  { value: 'webhook', labelKey: 'permission.resource.webhook', feature: TenantFeature.webhook },
  { value: 'tag', labelKey: 'permission.resource.tag', feature: null },
  {
    value: 'dataTransfer',
    labelKey: 'auditLog.resource.dataTransfer',
    feature: TenantFeature.dataTransfer,
  },
];

/** 篩選面板：動作關鍵字、資源、結果、日期區間。送出時一次寫進網址（`useAuditLogSearchFilter`）。 */
export function useAuditLogFilters({
  search,
  setFilter,
}: ReturnType<typeof useAuditLogSearchFilter>): FilterBarProps<AuditLogFilterValues> {
  const { t } = useTranslation();
  const isReady = useFeatureReadiness();
  return {
    value: {
      action: search.action,
      resourceType: search.resourceType,
      result: search.result,
      range: { from: search.from, to: search.to },
    },
    defaultValue: EMPTY_FILTERS,
    onSubmit: ({ range, ...rest }) => setFilter({ ...rest, from: range?.from, to: range?.to }),
    fields: [
      {
        type: 'text',
        key: 'action',
        label: t('auditLog.field.action'),
        placeholder: t('auditLog.filter.actionPlaceholder'),
      },
      {
        type: 'select',
        key: 'resourceType',
        label: t('auditLog.field.resource'),
        allLabel: t('auditLog.filter.allResources'),
        options: RESOURCE_OPTIONS.filter((option) => isReady(option.feature)).map((option) => ({
          value: option.value,
          label: t(option.labelKey),
        })),
      },
      {
        type: 'select',
        key: 'result',
        label: t('auditLog.field.result'),
        allLabel: t('auditLog.filter.allResults'),
        options: [
          { value: 'success', label: t('auditLog.result.success') },
          { value: 'failure', label: t('auditLog.result.failure') },
        ],
      },
      {
        type: 'dateRange',
        key: 'range',
        label: t('auditLog.filter.range'),
        max: formatDate(dayjs()),
        maxSpanDays: AUDIT_LOG_MAX_RANGE_DAYS,
      },
    ],
  };
}
