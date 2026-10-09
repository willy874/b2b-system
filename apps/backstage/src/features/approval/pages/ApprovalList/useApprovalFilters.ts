import type { FilterBarProps } from '@b2b-system/web-core/components';
import { useTranslation } from '@b2b-system/web-core/locales';

import { APPROVAL_TYPE_LABEL_KEY, APPROVAL_TYPES } from '../../constants';
import type { ApprovalSearchQuery } from '../../routes';
import type { useApprovalSearchFilter } from './useApprovalSearchFilter';

export type ApprovalFilterValues = Pick<ApprovalSearchQuery, 'keyword' | 'type' | 'sort'>;

const EMPTY_FILTERS: ApprovalFilterValues = {
  keyword: undefined,
  type: undefined,
  sort: [],
};

/**
 * 篩選面板：申請人、類型、多欄排序。送出時一次寫進網址（`useApprovalSearchFilter`）。
 * 狀態不在面板裡：列表上方的分段切換（預設待審，docs/architecture/backend/20-approval.md §11.2）。
 */
export function useApprovalFilters({
  search,
  setFilters,
}: ReturnType<typeof useApprovalSearchFilter>): FilterBarProps<ApprovalFilterValues> {
  const { t } = useTranslation();
  return {
    value: {
      keyword: search.keyword,
      type: search.type,
      sort: search.sort,
    },
    defaultValue: EMPTY_FILTERS,
    onSubmit: setFilters,
    fields: [
      {
        type: 'text',
        key: 'keyword',
        label: t('common.search'),
        placeholder: t('approval.list.searchPlaceholder'),
      },
      {
        type: 'select',
        key: 'type',
        label: t('approval.field.type'),
        allLabel: t('approval.type.all'),
        options: APPROVAL_TYPES.map((value) => ({
          value,
          label: t(APPROVAL_TYPE_LABEL_KEY[value]),
        })),
      },
      {
        type: 'sort',
        key: 'sort',
        label: t('common.sort'),
        options: [
          { value: 'createdAt', label: t('approval.field.createdAt') },
          { value: 'reviewedAt', label: t('approval.field.reviewedAt') },
        ],
      },
    ],
  };
}
