import { useQuery } from '@tanstack/react-query';
import { Outlet, useNavigate } from '@tanstack/react-router';
import { useMemo } from 'react';

import { getAnnouncementListQueryOptions } from '@/apis/announcement/get-announcement-list/query';
import { ButtonLink } from '@/components/Button';
import { useTranslation } from '@/core/locales';

import { ANNOUNCEMENT_STATUS_LABEL_KEY, ANNOUNCEMENT_STATUSES } from '../../constants';
import { useAnnouncementPermission } from '../../hooks/useAnnouncementPermission';
import { AnnouncementCreateRoute, AnnouncementDetailRoute } from '../../routes';
import { toAnnouncementRowVM } from './adapter';
import { AnnouncementTable } from './components/AnnouncementTable';
import { useAnnouncementSearchFilter } from './useAnnouncementSearchFilter';

/** 公告（docs/architecture/backend/19-announcement.md §9）：寫好訊息，立即或在指定時間以站內通知發給指定的對象。 */
export default function AnnouncementListPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const permission = useAnnouncementPermission();
  const { search, setKeyword, setStatus, setPage } = useAnnouncementSearchFilter();

  const { data, isPending, error, refetch } = useQuery(
    getAnnouncementListQueryOptions({
      params: {
        offset: search.offset,
        limit: search.limit,
        keyword: search.keyword,
        status: search.status,
      },
    }),
  );
  const rows = useMemo(() => (data?.items ?? []).map(toAnnouncementRowVM), [data]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4" data-testid="announcement-list-page">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="m-0 text-xl font-semibold">{t('announcement.list.title')}</h1>
          <p className="mt-1 text-sm text-[var(--color-fg-muted)]">
            {t('announcement.list.description')}
          </p>
        </div>
        {permission.canCreate && (
          <ButtonLink
            variant="primary"
            to={AnnouncementCreateRoute.to}
            search={search}
            data-testid="announcement-create-button"
          >
            {t('announcement.create.action')}
          </ButtonLink>
        )}
      </header>

      <AnnouncementTable
        rows={rows}
        loading={isPending}
        search={search}
        onRowDoubleClick={(row) =>
          void navigate({
            to: AnnouncementDetailRoute.to,
            params: { announcementId: row.id },
            search,
          })
        }
        searchBox={{
          value: search.keyword,
          onChange: setKeyword,
          placeholder: t('announcement.list.searchPlaceholder'),
        }}
        filters={{
          value: { status: search.status },
          defaultValue: { status: undefined },
          onSubmit: ({ status }) => setStatus(status),
          fields: [
            {
              type: 'select',
              key: 'status',
              label: t('announcement.field.status'),
              allLabel: t('announcement.list.allStatuses'),
              options: ANNOUNCEMENT_STATUSES.map((status) => ({
                value: status,
                label: t(ANNOUNCEMENT_STATUS_LABEL_KEY[status]),
              })),
            },
          ],
        }}
        error={error}
        onRetry={() => void refetch()}
        pagination={{
          offset: search.offset,
          limit: search.limit,
          total: data?.pagination.total ?? 0,
          onChange: ({ offset, limit }) => setPage(offset, limit),
        }}
      />

      {/* 對話框子路由（建立／詳情）掛在列表頁內，列表在背後保持掛載 */}
      <Outlet />
    </div>
  );
}
