import type { FilterBarProps } from '@/core/components';
import { useTranslation } from '@/core/locales';
import type { Tag } from '@/shared/api-sdk';

import { USER_STATUS_LABEL_KEY } from '../../constants';
import type { UserSearchQuery } from '../../routes';
import type { useUserSearchFilter } from './useUserSearchFilter';

export type UserFilterValues = Pick<UserSearchQuery, 'keyword' | 'status' | 'tagId' | 'sort'>;

const EMPTY_FILTERS: UserFilterValues = {
  keyword: undefined,
  status: undefined,
  tagId: undefined,
  sort: [],
};

/** 篩選面板：關鍵字、狀態、標籤、多欄排序。送出時一次寫進網址（`useUserSearchFilter`）。 */
export function useUserFilters(
  { search, setFilters }: ReturnType<typeof useUserSearchFilter>,
  /** `user` 標籤組的標籤；還沒載入或沒有任何標籤時不顯示標籤篩選。 */
  tags: readonly Tag[] = [],
): FilterBarProps<UserFilterValues> {
  const { t } = useTranslation();
  return {
    value: {
      keyword: search.keyword,
      status: search.status,
      tagId: search.tagId,
      sort: search.sort,
    },
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
      ...(tags.length
        ? [
            {
              type: 'multiSelect' as const,
              key: 'tagId' as const,
              label: t('tag.filter'),
              options: tags.map((tag) => ({ value: tag.id, label: tag.name })),
            },
          ]
        : []),
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
