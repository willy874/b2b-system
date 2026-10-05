import { formatDate } from '@b2b-system/ui/DatePicker';
import type { DateRangeFilterValue, FilterBarProps } from '@b2b-system/web-core/components';
import { useTranslation } from '@b2b-system/web-core/locales';
import dayjs from 'dayjs';

import { NOTIFICATION_EVENT_LABEL } from '../../constants';
import { NotificationOverviewRoute } from '../../routes';
import type { NotificationOverviewSearchQuery } from '../../routes';
import { RecipientSelect } from './components/RecipientSelect';

/** `type` 別名：`FilterBarProps` 要求可索引的物件型別（interface 沒有隱含的索引簽章）。 */
export type NotificationOverviewFilterValues = {
  type?: string;
  recipientId?: string;
  /** `select` 的值是字串：只有「未讀」一個選項，「全部」是 undefined。 */
  readState?: 'unread';
  /** 網址上是 `from` / `to` 兩個參數，面板裡合成一個日期區間欄位。 */
  range?: DateRangeFilterValue;
};

const EMPTY_FILTERS: NotificationOverviewFilterValues = {
  type: undefined,
  recipientId: undefined,
  readState: undefined,
  range: undefined,
};

/** 篩選全部放在網址；送出時一次寫入（docs/architecture/frontend/09-state-and-storage.md §1）。 */
export function useNotificationOverviewFilters(): {
  search: NotificationOverviewSearchQuery;
  filters: FilterBarProps<NotificationOverviewFilterValues>;
} {
  const { t } = useTranslation();
  const search = NotificationOverviewRoute.useSearch();
  const navigate = NotificationOverviewRoute.useNavigate();

  return {
    search,
    filters: {
      value: {
        type: search.type,
        recipientId: search.recipientId,
        readState: search.unread ? 'unread' : undefined,
        range: { from: search.from, to: search.to },
      },
      defaultValue: EMPTY_FILTERS,
      onSubmit: ({ type, recipientId, readState, range }) =>
        void navigate({
          search: {
            type,
            recipientId,
            unread: readState === 'unread' ? true : undefined,
            from: range?.from,
            to: range?.to,
          },
        }),
      fields: [
        {
          type: 'select',
          key: 'type',
          label: t('notification.overview.field.type'),
          allLabel: t('notification.overview.filter.allTypes'),
          options: Object.entries(NOTIFICATION_EVENT_LABEL).flatMap(([value, label]) =>
            label ? [{ value, label: t(label.nameKey) }] : [],
          ),
        },
        {
          type: 'custom',
          key: 'recipientId',
          label: t('notification.overview.field.recipient'),
          render: ({ value, onChange }) => <RecipientSelect value={value} onChange={onChange} />,
        },
        {
          type: 'select',
          key: 'readState',
          label: t('notification.overview.field.readAt'),
          allLabel: t('notification.overview.filter.allReadStates'),
          options: [{ value: 'unread', label: t('notification.filter.unread') }],
        },
        {
          type: 'dateRange',
          key: 'range',
          label: t('notification.overview.filter.range'),
          max: formatDate(dayjs()),
        },
      ],
    },
  };
}
