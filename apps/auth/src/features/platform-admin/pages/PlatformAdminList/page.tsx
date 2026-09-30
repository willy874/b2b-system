import { useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { useMemo, useState } from 'react';

import { getAuthProfileQueryOptions } from '@/apis/auth/get-profile/query';
import { getAdminListQueryOptions } from '@/apis/platform-admin/get-admin-list/query';
import { AlertDialog } from '@/components/AlertDialog';
import { Button, IconButton } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { Table } from '@/components/Table';
import { Tooltip } from '@/components/Tooltip';
import { useErrorToast } from '@/core/errors';
import { useTranslation } from '@/core/locales';
import type { PlatformAdmin } from '@/shared/api-sdk';
import { formatDateTime } from '@/shared/date';

import { PlatformAdminStatus } from '../../components/PlatformAdminStatus';
import { PLATFORM_ADMIN_ROLE_LABEL_KEY } from '../../constants';
import { useSendPlatformAdminPasswordLinkMutation } from '../../hooks/usePlatformAdminMutations';
import { usePlatformAdminPermission } from '../../hooks/usePlatformAdminPermission';
import { CreatePlatformAdminDialog } from './components/CreatePlatformAdminDialog';
import { EditPlatformAdminDialog } from './components/EditPlatformAdminDialog';

/**
 * 平台管理者清單（docs/adr/0020-physical-tenant-isolation.md D5）：
 * 新增（寄啟用信）、編輯名稱／角色／狀態、寄設定密碼的連結。不能變更自己的角色與狀態。
 */
export default function PlatformAdminListPage() {
  const { t } = useTranslation();
  const permission = usePlatformAdminPermission();
  const showError = useErrorToast();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<PlatformAdmin>();
  const [sendingLinkTo, setSendingLinkTo] = useState<PlatformAdmin>();
  const { data, isPending } = useQuery(getAdminListQueryOptions());
  const { data: profile } = useQuery(getAuthProfileQueryOptions());
  const sendLink = useSendPlatformAdminPasswordLinkMutation();
  const selfId = profile?.admin.id;
  const canUpdate = permission.canUpdate;

  const columns = useMemo<Array<ColumnDef<PlatformAdmin, unknown>>>(
    () => [
      {
        id: 'email',
        header: t('platformAdmin.field.email'),
        cell: ({ row }) => (
          <span data-testid="platform-admin-email" data-value={row.original.email}>
            {row.original.email}
          </span>
        ),
      },
      {
        id: 'displayName',
        header: t('platformAdmin.field.displayName'),
        cell: ({ row }) => (
          <span className="inline-flex items-center gap-2">
            {row.original.displayName}
            {row.original.id === selfId && (
              <span
                className="text-xs text-[var(--color-fg-muted)]"
                data-testid="platform-admin-self"
              >
                {t('platformAdmin.self')}
              </span>
            )}
          </span>
        ),
      },
      {
        id: 'role',
        header: t('platformAdmin.field.role'),
        cell: ({ row }) => (
          <span data-testid="platform-admin-role" data-value={row.original.role}>
            {t(PLATFORM_ADMIN_ROLE_LABEL_KEY[row.original.role])}
          </span>
        ),
      },
      {
        id: 'status',
        header: t('platformAdmin.field.status'),
        cell: ({ row }) => <PlatformAdminStatus status={row.original.status} />,
      },
      {
        id: 'lastLoginAt',
        header: t('platformAdmin.field.lastLoginAt'),
        cell: ({ row }) =>
          row.original.lastLoginAt ? formatDateTime(row.original.lastLoginAt) : '-',
      },
      ...(canUpdate
        ? [
            {
              id: 'actions',
              header: t('common.actions'),
              cell: ({ row }) => (
                <div className="flex gap-1">
                  <Tooltip content={t('platformAdmin.edit.action')}>
                    <IconButton
                      size="sm"
                      aria-label={t('platformAdmin.edit.action')}
                      onClick={() => setEditing(row.original)}
                      data-testid="platform-admin-edit"
                      data-value={row.original.email}
                    >
                      <Icon name="edit" size={16} />
                    </IconButton>
                  </Tooltip>
                  <Tooltip content={t('platformAdmin.passwordLink.action')}>
                    <IconButton
                      size="sm"
                      aria-label={t('platformAdmin.passwordLink.action')}
                      onClick={() => setSendingLinkTo(row.original)}
                      data-testid="platform-admin-password-link"
                      data-value={row.original.email}
                    >
                      <Icon name="key" size={16} />
                    </IconButton>
                  </Tooltip>
                </div>
              ),
            } satisfies ColumnDef<PlatformAdmin, unknown>,
          ]
        : []),
    ],
    [t, selfId, canUpdate],
  );

  return (
    <div className="flex flex-col gap-4" data-testid="platform-admin-page">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="m-0 text-xl font-semibold">{t('platformAdmin.title')}</h1>
          <p className="mt-1 text-sm text-[var(--color-fg-muted)]">
            {t('platformAdmin.description')}
          </p>
        </div>
        {permission.canCreate && (
          <Button
            variant="primary"
            onClick={() => setCreating(true)}
            data-testid="platform-admin-create-button"
          >
            {t('platformAdmin.create.action')}
          </Button>
        )}
      </header>

      <Table
        data={data?.items ?? []}
        columns={columns}
        getRowId={(row) => row.id}
        loading={isPending}
        emptyTitle={t('platformAdmin.empty')}
      />

      <CreatePlatformAdminDialog open={creating} onClose={() => setCreating(false)} />
      {editing && (
        <EditPlatformAdminDialog
          key={editing.id}
          admin={editing}
          isSelf={editing.id === selfId}
          onClose={() => setEditing(undefined)}
        />
      )}
      <AlertDialog
        open={sendingLinkTo !== undefined}
        onOpenChange={(open) => !open && setSendingLinkTo(undefined)}
        title={t('platformAdmin.passwordLink.title')}
        description={t('platformAdmin.passwordLink.confirm', { email: sendingLinkTo?.email })}
        confirmLabel={t('platformAdmin.passwordLink.send')}
        cancelLabel={t('common.cancel')}
        tone="primary"
        loading={sendLink.isPending}
        onConfirm={async () => {
          if (!sendingLinkTo) return;
          await sendLink.mutateAsync({ params: { id: sendingLinkTo.id } }).catch(showError);
          setSendingLinkTo(undefined);
        }}
      />
    </div>
  );
}
