import { useQuery } from '@tanstack/react-query';
import { Link, Outlet, useNavigate } from '@tanstack/react-router';
import type { ColumnDef } from '@tanstack/react-table';
import { useMemo, useState } from 'react';

import { getRoleListQueryOptions } from '@/apis/role/get-role-list/query';
import { AlertDialog } from '@/components/AlertDialog';
import { Button } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { Input } from '@/components/Input';
import { Pagination } from '@/components/Pagination';
import { Table } from '@/components/Table';
import { Tooltip } from '@/components/Tooltip';
import { useTranslation } from '@/core/locales';
import { formatDateTime } from '@/shared/date';

import { useRoleDeleteMutation } from '../../hooks/useRoleMutations';
import { useRolePermission } from '../../hooks/useRolePermission';
import { RoleCreateRoute, RoleDetailRoute } from '../../routes';
import { toRoleRowVM } from './adapter';
import type { RoleRowVM } from './adapter';
import { useRoleSearchFilter } from './useRoleSearchFilter';

export default function RoleListPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const permission = useRolePermission();
  const { search, setKeyword, setSort, setPage } = useRoleSearchFilter();
  const [keywordDraft, setKeywordDraft] = useState(search.keyword ?? '');
  const [pendingDelete, setPendingDelete] = useState<RoleRowVM>();
  const deleteRole = useRoleDeleteMutation();

  const { data, isPending } = useQuery(
    getRoleListQueryOptions({
      params: {
        offset: search.offset,
        limit: search.limit,
        keyword: search.keyword,
        sortBy: search.sortBy,
        sortOrder: search.sortOrder,
      },
    }),
  );

  const rows = useMemo(
    () => (data?.items ?? []).map((role) => toRoleRowVM(role, permission)),
    [data, permission],
  );

  const columns = useMemo<Array<ColumnDef<RoleRowVM, unknown>>>(
    () => [
      {
        id: 'name',
        header: t('role.field.name'),
        cell: ({ row }) => (
          <Link
            to={RoleDetailRoute.to}
            params={{ roleId: row.original.id }}
            search={search}
            className="font-medium text-[var(--color-brand)]"
            data-testid="role-name-link"
          >
            {row.original.name}
          </Link>
        ),
      },
      {
        id: 'slug',
        header: t('role.field.slug'),
        cell: ({ row }) => <code className="font-mono text-xs">{row.original.slug}</code>,
      },
      {
        id: 'description',
        header: t('role.field.description'),
        cell: ({ row }) => row.original.description,
      },
      {
        id: 'isSystem',
        header: t('role.field.type'),
        enableSorting: false,
        cell: ({ row }) =>
          row.original.isSystem ? (
            <Chip tone="brand">{t('role.type.system')}</Chip>
          ) : (
            <Chip tone="neutral">{t('role.type.custom')}</Chip>
          ),
      },
      {
        id: 'permissionCount',
        header: t('role.field.permissionCount'),
        enableSorting: false,
        cell: ({ row }) => row.original.permissionCount,
      },
      {
        id: 'userCount',
        header: t('role.field.userCount'),
        enableSorting: false,
        cell: ({ row }) => row.original.userCount,
      },
      {
        id: 'createdAt',
        header: t('role.field.createdAt'),
        cell: ({ row }) => formatDateTime(row.original.createdAt),
      },
      {
        id: 'actions',
        header: t('common.actions'),
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex gap-1">
            {/* 有權限但當下狀態不允許 → disable ＋ tooltip 說明 */}
            {permission.canDelete && (
              <Tooltip content={row.original.isSystem ? t('role.delete.systemProtected') : ''}>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!row.original.canDelete}
                  onClick={() => setPendingDelete(row.original)}
                  data-testid="role-delete-button"
                >
                  {t('common.delete')}
                </Button>
              </Tooltip>
            )}
          </div>
        ),
      },
    ],
    [permission, search, t],
  );

  return (
    <div className="flex flex-col gap-4" data-testid="role-list-page">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="m-0 text-xl font-semibold">{t('role.list.title')}</h1>
          <p className="mt-1 text-sm text-[var(--color-fg-muted)]">{t('role.list.description')}</p>
        </div>
        {/* 使用者永遠不會有這個權限時直接隱藏 */}
        {permission.canCreate && (
          <Button
            variant="primary"
            onClick={() => void navigate({ to: RoleCreateRoute.to, search })}
            data-testid="role-create-button"
          >
            {t('role.create.action')}
          </Button>
        )}
      </header>

      <div className="flex gap-2">
        <Input
          placeholder={t('role.list.searchPlaceholder')}
          value={keywordDraft}
          onChange={(event) => setKeywordDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') setKeyword(keywordDraft);
          }}
          className="max-w-xs"
          data-testid="role-search-input"
        />
        <Button onClick={() => setKeyword(keywordDraft)}>{t('common.search')}</Button>
      </div>

      <Table
        data={rows}
        columns={columns}
        loading={isPending}
        getRowId={(row) => row.id}
        emptyTitle={t('common.empty')}
        sorting={{ sortBy: search.sortBy, sortOrder: search.sortOrder }}
        onSortingChange={(sortBy, sortOrder) => setSort(sortBy as typeof search.sortBy, sortOrder)}
        onRowDoubleClick={(row) =>
          void navigate({ to: RoleDetailRoute.to, params: { roleId: row.id }, search })
        }
        data-testid="role-table"
      />

      <Pagination
        offset={search.offset}
        limit={search.limit}
        total={data?.pagination.total ?? 0}
        onChange={({ offset, limit }) => setPage(offset, limit)}
        labels={{
          previous: t('common.previous'),
          next: t('common.next'),
          summary: ({ from, to, total }) => `${from}-${to} / ${total}`,
        }}
      />

      <AlertDialog
        open={Boolean(pendingDelete)}
        onOpenChange={(open) => !open && setPendingDelete(undefined)}
        title={t('role.delete.title')}
        description={t('role.delete.confirm', { name: pendingDelete?.name ?? '' })}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        loading={deleteRole.isPending}
        onConfirm={async () => {
          if (!pendingDelete) return;
          await deleteRole
            .mutateAsync({ params: { roleId: pendingDelete.id } })
            .catch(() => undefined);
          setPendingDelete(undefined);
        }}
      />

      {/* 對話框子路由（建立／詳情）掛在列表頁內，列表在背後保持掛載 */}
      <Outlet />
    </div>
  );
}
