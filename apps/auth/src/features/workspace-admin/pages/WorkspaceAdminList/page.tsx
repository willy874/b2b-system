import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import type { ColumnDef } from '@tanstack/react-table';
import { useMemo, useState } from 'react';

import { getWorkspaceListQueryOptions } from '@/apis/workspace/get-workspace-list/query';
import { AlertDialog } from '@/components/AlertDialog';
import { Button, IconButton } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { Input } from '@/components/Input';
import { Pagination } from '@/components/Pagination';
import { Table } from '@/components/Table';
import { Tooltip } from '@/components/Tooltip';
import { useErrorToast } from '@/core/errors';
import { useTranslation } from '@/core/locales';
import type { Workspace } from '@/shared/api-sdk';
import { formatDateTime } from '@/shared/date';

import { useDeleteWorkspaceMutation } from '../../hooks/useWorkspaceMutations';
import { useWorkspaceAdminPermission } from '../../hooks/useWorkspacePermission';
import { WorkspaceAdminListRoute } from '../../routes';
import { AssignAdminDialog } from './components/AssignAdminDialog';
import { WorkspaceFormDialog } from './components/WorkspaceFormDialog';

const PAGE_SIZE = 20;

/**
 * 平台的工作區管理（docs/adr/0018-workspace-tenancy.md D5、D13）：
 * 名稱、成員數、建立與刪除、指定管理員；看不到工作區裡的內容。
 */
export default function WorkspaceAdminListPage() {
  const { t } = useTranslation();
  const permission = useWorkspaceAdminPermission();
  const search = WorkspaceAdminListRoute.useSearch();
  const navigate = useNavigate();
  const showError = useErrorToast();
  const remove = useDeleteWorkspaceMutation();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Workspace>();
  const [assigning, setAssigning] = useState<Workspace>();
  const [removing, setRemoving] = useState<Workspace>();

  const { data, isPending } = useQuery(
    getWorkspaceListQueryOptions({
      params: { offset: search.offset, limit: PAGE_SIZE, keyword: search.keyword },
    }),
  );

  const patchSearch = (next: Partial<typeof search>, replace = false) =>
    void navigate({ to: WorkspaceAdminListRoute.to, search: { ...search, ...next }, replace });

  const columns = useMemo<Array<ColumnDef<Workspace, unknown>>>(
    () => [
      {
        id: 'name',
        header: t('workspace.admin.field.name'),
        cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
      },
      {
        id: 'slug',
        header: t('workspace.admin.field.slug'),
        cell: ({ row }) => <code className="font-mono text-xs">{row.original.slug}</code>,
      },
      {
        id: 'memberCount',
        header: t('workspace.admin.field.memberCount'),
        accessorKey: 'memberCount',
      },
      {
        id: 'createdAt',
        header: t('workspace.admin.field.createdAt'),
        cell: ({ row }) => formatDateTime(row.original.createdAt),
      },
      {
        id: 'actions',
        header: '',
        cell: ({ row }) => (
          <div className="flex gap-1">
            {permission.canUpdate && (
              <>
                <Tooltip content={t('workspace.admin.edit.action')}>
                  <IconButton
                    size="sm"
                    aria-label={t('workspace.admin.edit.action')}
                    onClick={() => {
                      setEditing(row.original);
                      setFormOpen(true);
                    }}
                    data-testid="workspace-edit"
                    data-value={row.original.slug}
                  >
                    <Icon name="edit" size={16} />
                  </IconButton>
                </Tooltip>
                <Tooltip content={t('workspace.admin.assignAdmin.action')}>
                  <IconButton
                    size="sm"
                    aria-label={t('workspace.admin.assignAdmin.action')}
                    onClick={() => setAssigning(row.original)}
                    data-testid="workspace-assign-admin"
                    data-value={row.original.slug}
                  >
                    <Icon name="shield" size={16} />
                  </IconButton>
                </Tooltip>
              </>
            )}
            {permission.canDelete && (
              <Tooltip content={t('workspace.admin.remove.action')}>
                <IconButton
                  size="sm"
                  aria-label={t('workspace.admin.remove.action')}
                  onClick={() => setRemoving(row.original)}
                  data-testid="workspace-remove"
                  data-value={row.original.slug}
                >
                  <Icon name="trash" size={16} />
                </IconButton>
              </Tooltip>
            )}
          </div>
        ),
      },
    ],
    [permission.canDelete, permission.canUpdate, t],
  );

  return (
    <div className="flex flex-col gap-4" data-testid="workspace-admin-page">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="m-0 text-xl font-semibold">{t('workspace.admin.title')}</h1>
          <p className="mt-1 text-sm text-[var(--color-fg-muted)]">
            {t('workspace.admin.description')}
          </p>
        </div>
        {permission.canCreate && (
          <Button
            variant="primary"
            onClick={() => {
              setEditing(undefined);
              setFormOpen(true);
            }}
            data-testid="workspace-create-button"
          >
            {t('workspace.admin.create.action')}
          </Button>
        )}
      </header>

      <Input
        className="max-w-80"
        placeholder={t('workspace.admin.search')}
        defaultValue={search.keyword ?? ''}
        onChange={(event) =>
          patchSearch({ keyword: event.target.value || undefined, offset: 0 }, true)
        }
        data-testid="workspace-admin-search"
      />

      <Table
        data={data?.items ?? []}
        columns={columns}
        getRowId={(row) => row.id}
        loading={isPending}
        emptyTitle={t('workspace.admin.empty')}
      />
      <Pagination
        offset={search.offset}
        limit={PAGE_SIZE}
        total={data?.pagination.total ?? 0}
        onChange={({ offset }) => patchSearch({ offset })}
      />

      <WorkspaceFormDialog open={formOpen} workspace={editing} onClose={() => setFormOpen(false)} />
      <AssignAdminDialog workspace={assigning} onClose={() => setAssigning(undefined)} />
      <AlertDialog
        open={Boolean(removing)}
        onOpenChange={(open) => !open && setRemoving(undefined)}
        title={t('workspace.admin.remove.title')}
        description={t('workspace.admin.remove.confirm', { name: removing?.name ?? '' })}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        loading={remove.isPending}
        onConfirm={async () => {
          if (!removing) return;
          await remove.mutateAsync({ params: { workspaceId: removing.id } }).catch(showError);
          setRemoving(undefined);
        }}
      />
    </div>
  );
}
