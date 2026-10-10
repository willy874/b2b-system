import { ButtonLink } from '@b2b-system/ui/Button';
import { preloadRichTextEditor } from '@b2b-system/ui/LazyRichTextEditor';
import { PageHeader } from '@b2b-system/ui/PageHeader';
import { useTranslation } from '@b2b-system/web-core/locales';
import { useQuery } from '@tanstack/react-query';
import { Outlet, useNavigate } from '@tanstack/react-router';
import { useMemo } from 'react';

import { getAnnouncementListQueryOptions } from '@/apis/announcement/get-announcement-list/query';

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
      <PageHeader
        title={t('announcement.list.title')}
        description={t('announcement.list.description')}
        actions={
          permission.canCreate && (
            <ButtonLink
              variant="primary"
              to={AnnouncementCreateRoute.to}
              search={search}
              // 新增表單的內文編輯器是獨立的 chunk：滑過或聚焦按鈕就先下載
              onPointerEnter={preloadRichTextEditor}
              onFocus={preloadRichTextEditor}
              data-testid="announcement-create-button"
            >
              {t('announcement.create.action')}
            </ButtonLink>
          )
        }
      />

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
