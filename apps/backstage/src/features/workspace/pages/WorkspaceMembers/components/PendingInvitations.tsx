import { useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { useMemo, useState } from 'react';

import { getWorkspaceInvitationListQueryOptions } from '@/apis/workspace/get-workspace-invitation-list/query';
import { AlertDialog } from '@/components/AlertDialog';
import { IconButton } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { Icon } from '@/components/Icon';
import { Table } from '@/components/Table';
import { Tooltip } from '@/components/Tooltip';
import { useErrorToast } from '@/core/errors';
import { useTranslation } from '@/core/locales';
import type { WorkspaceInvitation } from '@/shared/api-sdk';
import { formatDateTime } from '@/shared/date';

import { useRevokeWorkspaceInvitationMutation } from '../../../hooks/useWorkspaceMutations';

interface PendingInvitationsProps {
  workspaceId: string;
  /** `workspaceMember:create`：可以撤銷。 */
  canRevoke: boolean;
}

/** 待接受的邀請（含已過期）。沒有任何邀請時整個區塊不顯示。 */
export function PendingInvitations({ workspaceId, canRevoke }: PendingInvitationsProps) {
  const { t } = useTranslation();
  const showError = useErrorToast();
  const { data } = useQuery(getWorkspaceInvitationListQueryOptions(workspaceId));
  const revoke = useRevokeWorkspaceInvitationMutation();
  const [revoking, setRevoking] = useState<WorkspaceInvitation>();

  const columns = useMemo<Array<ColumnDef<WorkspaceInvitation, unknown>>>(
    () => [
      {
        id: 'email',
        header: t('workspace.invitation.field.email'),
        cell: ({ row }) => (
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{row.original.email}</span>
            {!row.original.hasAccount && (
              <Chip tone="brand">{t('workspace.invitation.newAccount')}</Chip>
            )}
          </div>
        ),
      },
      {
        id: 'roles',
        header: t('workspace.invitation.field.roles'),
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
        id: 'invitedBy',
        header: t('workspace.invitation.field.invitedBy'),
        cell: ({ row }) => row.original.invitedBy?.displayName ?? '—',
      },
      {
        id: 'expiresAt',
        header: t('workspace.invitation.field.expiresAt'),
        cell: ({ row }) =>
          row.original.isExpired ? (
            <Chip tone="warning" data-testid="workspace-invitation-expired">
              {t('workspace.invitation.expired')}
            </Chip>
          ) : (
            formatDateTime(row.original.expiresAt)
          ),
      },
      {
        id: 'actions',
        header: '',
        cell: ({ row }) =>
          canRevoke && (
            <Tooltip content={t('workspace.invitation.revoke.action')}>
              <IconButton
                size="sm"
                aria-label={t('workspace.invitation.revoke.action')}
                onClick={() => setRevoking(row.original)}
                data-testid="workspace-invitation-revoke"
                data-value={row.original.email}
              >
                <Icon name="close" size={16} />
              </IconButton>
            </Tooltip>
          ),
      },
    ],
    [canRevoke, t],
  );

  if (!data || data.items.length === 0) return null;

  return (
    <section className="flex flex-col gap-2" data-testid="workspace-invitation-section">
      <h2 className="m-0 text-base font-semibold">
        {t('workspace.invitation.title', { count: data.items.length })}
      </h2>
      <Table data={data.items} columns={columns} getRowId={(row) => row.id} />
      <AlertDialog
        open={Boolean(revoking)}
        onOpenChange={(open) => !open && setRevoking(undefined)}
        title={t('workspace.invitation.revoke.title')}
        description={t('workspace.invitation.revoke.confirm', { email: revoking?.email ?? '' })}
        confirmLabel={t('workspace.invitation.revoke.action')}
        cancelLabel={t('common.cancel')}
        loading={revoke.isPending}
        onConfirm={async () => {
          if (!revoking) return;
          await revoke
            .mutateAsync({ params: { workspaceId, invitationId: revoking.id } })
            .catch(showError);
          setRevoking(undefined);
        }}
      />
    </section>
  );
}
