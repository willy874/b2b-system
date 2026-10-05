import type { FilterBarProps } from '@b2b-system/web-core/components';
import { useTranslation } from '@b2b-system/web-core/locales';

import { APPROVAL_STATUS_LABEL_KEY, APPROVAL_TYPE_LABEL_KEY } from '../../constants';
import type { ApprovalSearchQuery } from '../../routes';
import type { useApprovalSearchFilter } from './useApprovalSearchFilter';

export type ApprovalFilterValues = Pick<
  ApprovalSearchQuery,
  'keyword' | 'status' | 'type' | 'sort'
>;

const EMPTY_FILTERS: ApprovalFilterValues = {
  keyword: undefined,
  status: undefined,
  type: undefined,
  sort: [],
};

/** 篩選面板：申請人、狀態、類型、多欄排序。送出時一次寫進網址（`useApprovalSearchFilter`）。 */
export function useApprovalFilters({
  search,
  setFilters,
}: ReturnType<typeof useApprovalSearchFilter>): FilterBarProps<ApprovalFilterValues> {
  const { t } = useTranslation();
  return {
    value: {
      keyword: search.keyword,
      status: search.status,
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
        key: 'status',
        label: t('approval.field.status'),
        allLabel: t('approval.status.all'),
        options: [
          { value: 'pending', label: t(APPROVAL_STATUS_LABEL_KEY.pending) },
          { value: 'approved', label: t(APPROVAL_STATUS_LABEL_KEY.approved) },
          { value: 'rejected', label: t(APPROVAL_STATUS_LABEL_KEY.rejected) },
        ],
      },
      {
        type: 'select',
        key: 'type',
        label: t('approval.field.type'),
        allLabel: t('approval.type.all'),
        options: [{ value: 'user.register', label: t(APPROVAL_TYPE_LABEL_KEY['user.register']) }],
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
