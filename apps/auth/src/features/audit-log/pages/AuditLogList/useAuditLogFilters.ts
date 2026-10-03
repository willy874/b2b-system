import dayjs from 'dayjs';

import { formatDate } from '@/components/DatePicker';
import type { DateRangeFilterValue, FilterBarProps } from '@/core/components';
import { useTranslation } from '@/core/locales';

import { AUDIT_LOG_MAX_RANGE_DAYS } from '../../constants';
import type { AuditLogSearchQuery } from '../../routes';
import type { useAuditLogSearchFilter } from './useAuditLogSearchFilter';

export type AuditLogFilterValues = Pick<AuditLogSearchQuery, 'action' | 'actorEmail' | 'result'> & {
  /** 網址上是 `from` / `to` 兩個參數，面板裡合成一個日期區間欄位。 */
  range?: DateRangeFilterValue;
};

const EMPTY_FILTERS: AuditLogFilterValues = {
  action: undefined,
  actorEmail: undefined,
  result: undefined,
  range: undefined,
};

/**
 * 篩選面板：動作、操作者信箱、結果、日期區間。送出時一次寫進網址（`useAuditLogSearchFilter`）。
 * 平台稽核的 API 沒有「資源類型」條件（只有 `resourceId`），所以不提供資源篩選。
 */
export function useAuditLogFilters({
  search,
  setFilter,
}: ReturnType<typeof useAuditLogSearchFilter>): FilterBarProps<AuditLogFilterValues> {
  const { t } = useTranslation();
  return {
    value: {
      action: search.action,
      actorEmail: search.actorEmail,
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
        type: 'text',
        key: 'actorEmail',
        label: t('auditLog.filter.actorEmail'),
        placeholder: t('auditLog.filter.actorEmailPlaceholder'),
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
