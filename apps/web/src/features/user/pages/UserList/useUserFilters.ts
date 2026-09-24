import type { FilterBarProps } from '@/core/components';
import { useTranslation } from '@/core/locales';

import { USER_STATUS_LABEL_KEY } from '../../constants';
import type { UserSearchQuery } from '../../routes';
import type { useUserSearchFilter } from './useUserSearchFilter';

type UserFilterValues = Pick<UserSearchQuery, 'keyword' | 'status'>;

const EMPTY_FILTERS: UserFilterValues = { keyword: undefined, status: undefined };

/** 篩選面板：關鍵字 ＋ 狀態。送出時一次寫進網址（`useUserSearchFilter`）。 */
export function useUserFilters({
  search,
  setFilters,
}: ReturnType<typeof useUserSearchFilter>): FilterBarProps<UserFilterValues> {
  const { t } = useTranslation();
  return {
    value: { keyword: search.keyword, status: search.status },
    defaultValue: EMPTY_FILTERS,
    onSubmit: setFilters,
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
    ],
  };
}
