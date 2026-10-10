import { Empty } from '@b2b-system/ui/Empty';
import { Pagination } from '@b2b-system/ui/Pagination';
import type { TableColumnDef } from '@b2b-system/ui/Table';
import { Table } from '@b2b-system/ui/Table';
import { Tabs } from '@b2b-system/ui/Tabs';
import { QueryError } from '@b2b-system/web-core/components';
import { useTranslation } from '@b2b-system/web-core/locales';
import { useQuery } from '@tanstack/react-query';
import { Suspense, useMemo } from 'react';

import { getTrashListQueryOptions } from '@/apis/trash/get-trash-list/query';
import type { TrashTypeRegistration } from '@/core/trash';

import { useTrashPermission } from '../../hooks/useTrashPermission';
import { toTrashRowVM } from './adapter';
import type { TrashRowVM } from './adapter';
import { useTrashSearch } from './useTrashSearch';

/**
 * 回收桶（docs/architecture/frontend/13-trash.md、docs/architecture/backend/14-revisions.md §9.2 D9）：每個看得到的資源類型一個分頁，
 * 列出已刪除的項目與預計永久刪除的時間；還原操作由擁有資源的 feature 登記的元件提供。
 */
export default function TrashListPage() {
  const { t } = useTranslation();
  const { hydrated, types } = useTrashPermission();
  const { search, active, setType, setPage } = useTrashSearch(types);

  return (
    <div className="flex flex-col gap-4" data-testid="trash-page">
      <header>
        <h1 className="m-0 text-xl font-semibold">{t('trash.title')}</h1>
        <p className="mt-1 text-sm text-[var(--color-fg-muted)]">{t('trash.description')}</p>
      </header>

      {active ? (
        <Tabs
          moreLabel={t('common.more')}
          value={active.type}
          onValueChange={setType}
          tabs={types.map((type) => ({ value: type.type, label: t(type.labelI18nKey) }))}
          data-testid="trash-tabs"
        >
          <TrashTypeList
            type={active}
            offset={search.offset}
            limit={search.limit}
            onPageChange={setPage}
          />
        </Tabs>
      ) : (
        hydrated && <Empty title={t('trash.noType')} data-testid="trash-no-type" />
      )}
    </div>
  );
}

interface TrashTypeListProps {
  type: TrashTypeRegistration;
  offset: number;
  limit: number;
  onPageChange: (offset: number, limit: number) => void;
}

function TrashTypeList({ type, offset, limit, onPageChange }: TrashTypeListProps) {
  const { t } = useTranslation();
  const { RestoreAction } = type;
  const { data, isPending, error, refetch } = useQuery(
    getTrashListQueryOptions({ params: { type: type.type, offset, limit } }),
  );
  const rows = useMemo(() => (data?.items ?? []).map(toTrashRowVM), [data]);

  const columns = useMemo<Array<TableColumnDef<TrashRowVM>>>(
    () => [
      {
        id: 'name',
        header: t('trash.field.name'),
        cell: ({ row }) => (
          <div className="flex flex-col">
            <span className="font-medium">{row.original.name}</span>
            <span className="text-xs text-[var(--color-fg-muted)]">{row.original.description}</span>
          </div>
        ),
      },
      {
        id: 'deletedAt',
        header: t('trash.field.deletedAt'),
        cell: ({ row }) => row.original.deletedAt,
      },
      {
        id: 'deletedBy',
        header: t('trash.field.deletedBy'),
        cell: ({ row }) => row.original.deletedBy,
      },
      { id: 'purgeAt', header: t('trash.field.purgeAt'), cell: ({ row }) => row.original.purgeAt },
      {
        id: 'actions',
        header: '',
        // 還原按鈕以 lazy() 登記（core/trash）：第一次渲染時下載，期間留白
        cell: ({ row }) => (
          <Suspense fallback={null}>
            <RestoreAction item={row.original.item} />
          </Suspense>
        ),
      },
    ],
    [RestoreAction, t],
  );

  // 查詢失敗而且沒有舊資料：顯示錯誤與重試，不落到「回收桶是空的」
  if (error && !data) {
    return (
      <QueryError
        className="mt-4"
        error={error}
        onRetry={() => void refetch()}
        data-testid="trash-error"
      />
    );
  }

  return (
    <div className="mt-4 flex flex-col gap-3">
      <Table
        data={rows}
        columns={columns}
        getRowId={(row) => row.id}
        loading={isPending}
        emptyTitle={t('trash.empty')}
        data-testid="trash-table"
      />
      <Pagination
        offset={offset}
        limit={limit}
        total={data?.pagination.total ?? 0}
        onChange={(next) => onPageChange(next.limit !== limit ? 0 : next.offset, next.limit)}
        labels={{
          previous: t('common.previous'),
          next: t('common.next'),
          summary: ({ from, to, total }) => t('trash.pagination.summary', { from, to, total }),
        }}
        data-testid="trash-pagination"
      />
    </div>
  );
}
