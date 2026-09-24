import type { FilterBarProps } from '@/core/components';
import { useTranslation } from '@/core/locales';

import type { RoleSearchQuery } from '../../routes';
import type { useRoleSearchFilter } from './useRoleSearchFilter';

type RoleFilterValues = Pick<RoleSearchQuery, 'keyword'>;

const EMPTY_FILTERS: RoleFilterValues = { keyword: undefined };

/** 篩選面板：關鍵字。送出時寫進網址（`useRoleSearchFilter`）。 */
export function useRoleFilters({
  search,
  setFilters,
}: ReturnType<typeof useRoleSearchFilter>): FilterBarProps<RoleFilterValues> {
  const { t } = useTranslation();
  return {
    value: { keyword: search.keyword },
    defaultValue: EMPTY_FILTERS,
    onSubmit: setFilters,
    fields: [
      {
        type: 'text',
        key: 'keyword',
        label: t('common.search'),
        placeholder: t('role.list.searchPlaceholder'),
      },
    ],
  };
}
