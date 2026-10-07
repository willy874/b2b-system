import { formatDate } from '@b2b-system/ui/DatePicker';
import type { DateRangeFilterValue, FilterBarProps } from '@b2b-system/web-core/components';
import { useTranslation } from '@b2b-system/web-core/locales';
import dayjs from 'dayjs';

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

/** 篩選面板：動作關鍵字、資源、結果、日期區間。送出時一次寫進網址（`useAuditLogSearchFilter`）。 */
export function useAuditLogFilters({
  search,
  setFilter,
}: ReturnType<typeof useAuditLogSearchFilter>): FilterBarProps<AuditLogFilterValues> {
  const { t } = useTranslation();
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
        options: [
          { value: 'user', label: t('permission.resource.user') },
          { value: 'role', label: t('permission.resource.role') },
          { value: 'approval', label: t('permission.resource.approval') },
          { value: 'file', label: t('permission.resource.file') },
          { value: 'auth', label: t('auditLog.resource.auth') },
          { value: 'authz', label: t('auditLog.resource.authz') },
          { value: 'serviceAccount', label: t('permission.resource.serviceAccount') },
          { value: 'apiToken', label: t('auditLog.resource.apiToken') },
          { value: 'webhook', label: t('permission.resource.webhook') },
          { value: 'tag', label: t('permission.resource.tag') },
          { value: 'dataTransfer', label: t('auditLog.resource.dataTransfer') },
        ],
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
