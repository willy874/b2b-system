import { Button } from '@b2b-system/ui/Button';
import { useConfirm } from '@b2b-system/ui/ConfirmDialog';
import type { TableColumnDef } from '@b2b-system/ui/Table';
import { Table } from '@b2b-system/ui/Table';
import { QueryError } from '@b2b-system/web-core/components';
import { useTranslation } from '@b2b-system/web-core/locales';
import { formatDateTime } from '@b2b-system/web-shared/date';
import { useMemo } from 'react';

import type { UserIdentity } from '@/shared/api-sdk';

import { useUserIdentities } from '../../../hooks/useUserIdentities';

const PROTOCOL_LABEL_KEY = {
  oidc: 'user.identities.protocol.oidc',
  saml: 'user.identities.protocol.saml',
} as const satisfies Record<UserIdentity['protocol'], string>;

interface UserIdentitySectionProps {
  userId: string;
  /** `user:update`：解除連結（目標是 super-admin 時操作者也要是，後端判斷）。 */
  canUnlink: boolean;
}

/**
 * 這位使用者連結的外部身分（docs/architecture/04-sso.md §3.3.4）。連錯人、員工換了 IdP 帳號時解除；
 * 之後那個外部身分登入會重新以 email 對應帳號。
 */
export function UserIdentitySection({ userId, canUnlink }: UserIdentitySectionProps) {
  const { t } = useTranslation();
  const { identities, unlink } = useUserIdentities(userId);
  const confirm = useConfirm();
  const { mutateAsync: unlinkIdentity } = unlink;

  const columns = useMemo<Array<TableColumnDef<UserIdentity>>>(
    () => [
      {
        id: 'provider',
        header: t('user.identities.provider'),
        cell: ({ row }) => (
          <div className="flex flex-col">
            <span>
              {row.original.providerName}
              {row.original.providerDeleted && ` · ${t('user.identities.providerDeleted')}`}
            </span>
            <span className="text-xs text-[var(--color-fg-muted)]">
              {t(PROTOCOL_LABEL_KEY[row.original.protocol])}
            </span>
          </div>
        ),
      },
      {
        id: 'subject',
        header: t('user.identities.subject'),
        cell: ({ row }) => (
          <div className="flex flex-col">
            <code className="font-mono text-xs break-all">{row.original.subject}</code>
            {row.original.email && (
              <span className="text-xs text-[var(--color-fg-muted)]">{row.original.email}</span>
            )}
          </div>
        ),
      },
      {
        id: 'lastLoginAt',
        header: t('user.identities.lastLoginAt'),
        cell: ({ row }) =>
          row.original.lastLoginAt ? formatDateTime(row.original.lastLoginAt) : '—',
      },
      ...(canUnlink
        ? [
            {
              id: 'actions',
              header: '',
              cell: ({ row }: { row: { original: UserIdentity } }) => (
                <Button
                  size="sm"
                  onClick={() =>
                    void confirm({
                      title: t('user.identities.unlinkTitle'),
                      description: t('user.identities.unlinkConfirm', {
                        provider: row.original.providerName,
                      }),
                      confirmLabel: t('user.identities.unlink'),
                      tone: 'danger',
                      // 失敗時對話框留著，錯誤由 mutation 的 onError 顯示（docs/architecture/frontend/07-ui-system.md §3.11）
                      onConfirm: () =>
                        unlinkIdentity({ params: { userId, identityId: row.original.id } }),
                      'data-testid': 'user-identity-unlink-confirm',
                    })
                  }
                  data-testid="user-identity-unlink"
                  data-value={row.original.id}
                >
                  {t('user.identities.unlink')}
                </Button>
              ),
            },
          ]
        : []),
    ],
    [canUnlink, confirm, t, unlinkIdentity, userId],
  );

  return (
    <section className="flex flex-col gap-2" data-testid="user-identities">
      <h3 className="m-0 text-sm font-semibold">{t('user.identities.title')}</h3>
      <p className="m-0 text-xs text-[var(--color-fg-muted)]">{t('user.identities.hint')}</p>
      {identities.isError ? (
        <QueryError error={identities.error} onRetry={() => void identities.refetch()} />
      ) : (
        <Table
          data={identities.data?.items ?? []}
          columns={columns}
          getRowId={(row) => row.id}
          loading={identities.isPending}
          emptyTitle={t('user.identities.empty')}
        />
      )}
    </section>
  );
}
