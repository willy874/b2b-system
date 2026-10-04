import type { FilterBarProps } from '@/core/components';
import { useTranslation } from '@/core/locales';

import { TENANT_STATUS_LABEL_KEY } from '../../constants';
import type { TenantSearchQuery } from '../../routes';
import type { useTenantSearchFilter } from './useTenantSearchFilter';

export type TenantFilterValues = Pick<TenantSearchQuery, 'q' | 'status'>;

const EMPTY_FILTERS: TenantFilterValues = { q: undefined, status: undefined };

/**
 * 篩選面板：狀態。關鍵字（代碼、名稱或網域）由表格上方常駐的搜尋框輸入，仍保留在 value 裡：
 * 面板送出與「清除篩選」時一起處理，不會互相蓋掉。
 */
export function useTenantFilters({
  search,
  setFilters,
}: ReturnType<typeof useTenantSearchFilter>): FilterBarProps<TenantFilterValues> {
  const { t } = useTranslation();
  return {
    value: { q: search.q, status: search.status },
    defaultValue: EMPTY_FILTERS,
    onSubmit: setFilters,
    fields: [
      {
        type: 'select',
        key: 'status',
        label: t('tenant.field.status'),
        allLabel: t('tenant.filter.all'),
        options: [
          { value: 'active', label: t(TENANT_STATUS_LABEL_KEY.active) },
          { value: 'provisioning', label: t(TENANT_STATUS_LABEL_KEY.provisioning) },
          { value: 'failed', label: t(TENANT_STATUS_LABEL_KEY.failed) },
          { value: 'disabled', label: t(TENANT_STATUS_LABEL_KEY.disabled) },
        ],
      },
    ],
  };
}
