import type { FilterBarProps } from '@/core/components';
import { useTranslation } from '@/core/locales';

import type { RoleSearchQuery } from '../../routes';
import type { useRoleSearchFilter } from './useRoleSearchFilter';

export type RoleFilterValues = Pick<RoleSearchQuery, 'keyword' | 'sort'>;

const EMPTY_FILTERS: RoleFilterValues = { keyword: undefined, sort: [] };

/** 篩選面板：關鍵字、多欄排序。送出時一次寫進網址（`useRoleSearchFilter`）。 */
export function useRoleFilters({
  search,
  setFilters,
}: ReturnType<typeof useRoleSearchFilter>): FilterBarProps<RoleFilterValues> {
  const { t } = useTranslation();
  return {
    value: { keyword: search.keyword, sort: search.sort },
    defaultValue: EMPTY_FILTERS,
    // 排序條件全部移除＝不指定，由後端套用預設排序
    onSubmit: setFilters,
    fields: [
      {
        type: 'text',
        key: 'keyword',
        label: t('common.search'),
        placeholder: t('role.list.searchPlaceholder'),
      },
      {
        type: 'sort',
        key: 'sort',
        label: t('common.sort'),
        options: [
          { value: 'createdAt', label: t('role.field.createdAt') },
          { value: 'name', label: t('role.field.name') },
          { value: 'slug', label: t('role.field.slug') },
        ],
      },
    ],
  };
}
