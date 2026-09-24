import type { FilterBarProps } from '@/core/components';
import { useTranslation } from '@/core/locales';

import { USER_STATUS_LABEL_KEY } from '../../constants';
import { DEFAULT_USER_SORT } from '../../routes';
import type { UserSearchQuery } from '../../routes';
import type { useUserSearchFilter } from './useUserSearchFilter';

export type UserFilterValues = Pick<UserSearchQuery, 'keyword' | 'status' | 'sort'>;

const EMPTY_FILTERS: UserFilterValues = {
  keyword: undefined,
  status: undefined,
  sort: DEFAULT_USER_SORT,
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
    // 排序條件全部移除時退回預設排序（後端至少要一個條件）
    onSubmit: ({ sort, ...rest }) =>
      setFilters({ ...rest, sort: sort.length ? sort : DEFAULT_USER_SORT }),
    fields: [
      {
        type: 'text',
        key: 'keyword',
        label: t('common.search'),
        placeholder: t('user.list.searchPlaceholder'),
      },
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
