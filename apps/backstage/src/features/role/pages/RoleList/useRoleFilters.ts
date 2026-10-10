import type { FilterBarProps } from '@b2b-system/web-core/components';
import { useTranslation } from '@b2b-system/web-core/locales';
import type { useListSearch } from '@b2b-system/web-core/router';

import type { RoleSearchQuery } from '../../routes';

export type RoleFilterValues = Pick<RoleSearchQuery, 'keyword' | 'sort'>;

const EMPTY_FILTERS: RoleFilterValues = { keyword: undefined, sort: [] };

/** 篩選面板：關鍵字、多欄排序。送出時一次寫進網址（`useListSearch`）。 */
export function useRoleFilters({
  search,
  setFilters,
}: ReturnType<typeof useListSearch<RoleSearchQuery>>): FilterBarProps<RoleFilterValues> {
  const { t } = useTranslation();
  return {
    value: { keyword: search.keyword, sort: search.sort },
    defaultValue: EMPTY_FILTERS,
    // 排序條件全部移除＝不指定，由後端套用預設排序。
    // 關鍵字改由表格上方常駐的搜尋框輸入，仍保留在 value 裡：面板送出與「清除篩選」時一起處理
    onSubmit: setFilters,
    fields: [
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
