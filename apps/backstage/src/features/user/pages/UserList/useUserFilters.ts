import type { FilterBarProps } from '@/core/components';
import { useTranslation } from '@/core/locales';

import { USER_STATUS_LABEL_KEY } from '../../constants';
import type { UserSearchQuery } from '../../routes';
import type { useUserSearchFilter } from './useUserSearchFilter';

export type UserFilterValues = Pick<UserSearchQuery, 'keyword' | 'status' | 'sort'>;

const EMPTY_FILTERS: UserFilterValues = {
  keyword: undefined,
  status: undefined,
  sort: [],
};

/** 篩選面板：關鍵字、狀態、多欄排序。送出時一次寫進網址（`useUserSearchFilter`）。 */
export function useUserFilters({
  search,
  setFilters,
}: ReturnType<typeof useUserSearchFilter>): FilterBarProps<UserFilterValues> {
  const { t } = useTranslation();
  return {
    value: { keyword: search.keyword, status: search.status, sort: search.sort },
    defaultValue: EMPTY_FILTERS,
    // 排序條件全部移除＝不指定，由後端套用預設排序。
    // 關鍵字改由表格上方常駐的搜尋框輸入，仍保留在 value 裡：面板送出與「清除篩選」時一起處理
    onSubmit: setFilters,
    fields: [
      {
        type: 'select',
        key: 'status',
        label: t('user.field.status'),
        allLabel: t('user.status.all'),
        options: [
          { value: 'active', label: t(USER_STATUS_LABEL_KEY.active) },
          { value: 'pending', label: t(USER_STATUS_LABEL_KEY.pending) },
          { value: 'inactive', label: t(USER_STATUS_LABEL_KEY.inactive) },
          { value: 'locked', label: t(USER_STATUS_LABEL_KEY.locked) },
        ],
      },
      {
        type: 'sort',
        key: 'sort',
        label: t('common.sort'),
        options: [
          { value: 'createdAt', label: t('user.field.createdAt') },
          { value: 'displayName', label: t('user.field.displayName') },
          { value: 'email', label: t('user.field.email') },
          { value: 'lastLoginAt', label: t('user.field.lastLoginAt') },
        ],
      },
    ],
  };
}
