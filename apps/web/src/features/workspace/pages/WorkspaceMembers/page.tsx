import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import type { ColumnDef } from '@tanstack/react-table';
import { useMemo, useState } from 'react';

import { getWorkspaceMemberListQueryOptions } from '@/apis/workspace/get-workspace-member-list/query';
import { AlertDialog } from '@/components/AlertDialog';
import { IconButton } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { Icon } from '@/components/Icon';
import { Input } from '@/components/Input';
import { Pagination } from '@/components/Pagination';
import { Table } from '@/components/Table';
import { Tooltip } from '@/components/Tooltip';
import { useErrorToast } from '@/core/errors';
import { useTranslation } from '@/core/locales';
import { useRequiredWorkspace } from '@/core/workspace';
import type { WorkspaceMember } from '@/shared/api-sdk';
import { formatDateTime } from '@/shared/date';

import { useDeleteWorkspaceMemberMutation } from '../../hooks/useWorkspaceMutations';
import { useWorkspaceMemberPermission } from '../../hooks/useWorkspacePermission';
import { WorkspaceMembersRoute } from '../../routes';
import { MemberRolesDialog } from './components/MemberRolesDialog';

const PAGE_SIZE = 20;

/** 工作區的成員與他們的工作區角色（docs/adr/0018-workspace-tenancy.md D11、D12）。 */
export default function WorkspaceMembersPage() {
  const { t } = useTranslation();
  const workspace = useRequiredWorkspace();
  const permission = useWorkspaceMemberPermission();
  const search = WorkspaceMembersRoute.useSearch();
  const navigate = useNavigate();
  const showError = useErrorToast();
  const remove = useDeleteWorkspaceMemberMutation();
  const [editing, setEditing] = useState<WorkspaceMember>();
  const [removing, setRemoving] = useState<WorkspaceMember>();

  const { data, isPending } = useQuery(
    getWorkspaceMemberListQueryOptions({
      params: {
        workspaceId: workspace.id,
        offset: search.offset,
        limit: PAGE_SIZE,
        keyword: search.keyword,
      },
    }),
  );

  const patchSearch = (next: Partial<typeof search>, replace = false) =>
    void navigate({
      to: WorkspaceMembersRoute.to,
      params: { workspaceSlug: workspace.slug },
      search: { ...search, ...next },
      replace,
    });

  const columns = useMemo<Array<ColumnDef<WorkspaceMember, unknown>>>(
    () => [
      {
        id: 'name',
        header: t('workspace.member.field.name'),
        cell: ({ row }) => <span className="font-medium">{row.original.displayName}</span>,
      },
      { id: 'email', header: t('workspace.member.field.email'), accessorKey: 'email' },
      {
        id: 'roles',
        header: t('workspace.member.field.roles'),
        cell: ({ row }) =>
          row.original.roles.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {row.original.roles.map((role) => (
                <Chip key={role.id}>{role.name}</Chip>
              ))}
            </div>
          ) : (
            <span className="text-[var(--color-fg-muted)]">{t('workspace.member.noRole')}</span>
          ),
      },
      {
        id: 'joinedAt',
        header: t('workspace.member.field.joinedAt'),
        cell: ({ row }) => formatDateTime(row.original.joinedAt),
      },
      {
        id: 'actions',
        header: '',
        cell: ({ row }) => (
          <div className="flex gap-1">
            {permission.canAssignRole && (
              <Tooltip content={t('workspace.member.editRoles.action')}>
                <IconButton
                  size="sm"
                  aria-label={t('workspace.member.editRoles.action')}
                  onClick={() => setEditing(row.original)}
                  data-testid="workspace-member-edit-roles"
                  data-value={row.original.email}
                >
                  <Icon name="shield" size={16} />
                </IconButton>
              </Tooltip>
            )}
            {permission.canRemove && (
              <Tooltip content={t('workspace.member.remove.action')}>
                <IconButton
                  size="sm"
                  aria-label={t('workspace.member.remove.action')}
                  onClick={() => setRemoving(row.original)}
                  data-testid="workspace-member-remove"
                  data-value={row.original.email}
                >
                  <Icon name="trash" size={16} />
                </IconButton>
              </Tooltip>
            )}
          </div>
        ),
      },
    ],
    [permission.canAssignRole, permission.canRemove, t],
  );

  return (
    <div className="flex flex-col gap-4" data-testid="workspace-member-page">
      <header>
        <h1 className="m-0 text-xl font-semibold">{t('workspace.member.title')}</h1>
        <p className="mt-1 text-sm text-[var(--color-fg-muted)]">
          {t('workspace.member.description')}
        </p>
      </header>

      <Input
        className="max-w-80"
        placeholder={t('workspace.member.search')}
        defaultValue={search.keyword ?? ''}
        onChange={(event) =>
          patchSearch({ keyword: event.target.value || undefined, offset: 0 }, true)
        }
        data-testid="workspace-member-search"
      />

      <Table
        data={data?.items ?? []}
        columns={columns}
        getRowId={(row) => row.id}
        loading={isPending}
        emptyTitle={t('workspace.member.empty')}
      />
      <Pagination
        offset={search.offset}
        limit={PAGE_SIZE}
        total={data?.pagination.total ?? 0}
        onChange={({ offset }) => patchSearch({ offset })}
      />

      <MemberRolesDialog
        workspaceId={workspace.id}
        member={editing}
        onClose={() => setEditing(undefined)}
      />
      <AlertDialog
        open={Boolean(removing)}
        onOpenChange={(open) => !open && setRemoving(undefined)}
        title={t('workspace.member.remove.title')}
        description={t('workspace.member.remove.confirm', { name: removing?.displayName ?? '' })}
        confirmLabel={t('workspace.member.remove.action')}
        cancelLabel={t('common.cancel')}
        loading={remove.isPending}
        onConfirm={async () => {
          if (!removing) return;
          await remove
            .mutateAsync({ params: { workspaceId: workspace.id, userId: removing.id } })
            .catch(showError);
          setRemoving(undefined);
        }}
      />
    </div>
  );
}
