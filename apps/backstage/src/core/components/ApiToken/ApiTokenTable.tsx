import { useMemo } from 'react';

import { IconButton } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { useConfirm } from '@/components/ConfirmDialog';
import { Icon } from '@/components/Icon';
import { Table } from '@/components/Table';
import type { TableColumnDef } from '@/components/Table';
import { Tooltip } from '@/components/Tooltip';
import { Text } from '@/components/Typography';
import { useTranslation } from '@/core/locales';
import type { ApiToken } from '@/shared/api-sdk';
import { formatDateTime, formatRelativeTime } from '@/shared/date';

import { API_TOKEN_STATUS_LABEL_KEY, API_TOKEN_STATUS_TONE } from './constants';

export interface ApiTokenTableProps {
  tokens: ApiToken[] | undefined;
  loading?: boolean;
  /** 能不能撤銷（本人、`user:update`、`serviceAccount:update`）；已撤銷的不顯示按鈕。 */
  canRevoke: boolean;
  /** 撤銷；確認對話框由這個元件負責，丟錯時對話框留著（錯誤提示交給呼叫端）。 */
  onRevoke: (token: ApiToken) => Promise<unknown>;
  'data-testid'?: string;
}

/**
 * 一個帳號的 API token（docs/architecture/06-external-api.md §9）：服務帳號詳情、個人資料、使用者詳情共用。
 * 只顯示 token 的開頭（`prefix`），完整的 token 只在建立時出現一次。
 */
export function ApiTokenTable({
  tokens,
  loading,
  canRevoke,
  onRevoke,
  'data-testid': testId,
}: ApiTokenTableProps) {
  const { t } = useTranslation();
  const confirm = useConfirm();

  const columns = useMemo<Array<TableColumnDef<ApiToken>>>(
    () => [
      {
        id: 'name',
        header: t('apiToken.field.name'),
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex flex-col">
            <span className="font-medium">{row.original.name}</span>
            <Text code className="text-xs" data-testid="api-token-prefix">
              {row.original.prefix}…
            </Text>
          </div>
        ),
      },
      {
        id: 'status',
        header: t('apiToken.field.status'),
        enableSorting: false,
        cell: ({ row }) => (
          <Chip
            tone={API_TOKEN_STATUS_TONE[row.original.status]}
            data-testid="api-token-status"
            data-value={row.original.status}
          >
            {t(API_TOKEN_STATUS_LABEL_KEY[row.original.status])}
          </Chip>
        ),
      },
      {
        id: 'scopes',
        header: t('apiToken.field.scopes'),
        enableSorting: false,
        cell: ({ row }) =>
          row.original.scopes
            ? t('apiToken.scopes.limited', { count: row.original.scopes.length })
            : t('apiToken.scopes.all'),
      },
      {
        id: 'expiresAt',
        header: t('apiToken.field.expiresAt'),
        enableSorting: false,
        cell: ({ row }) => formatDateTime(row.original.expiresAt),
      },
      {
        id: 'lastUsedAt',
        header: t('apiToken.field.lastUsedAt'),
        enableSorting: false,
        cell: ({ row }) =>
          row.original.lastUsedAt
            ? formatRelativeTime(row.original.lastUsedAt)
            : t('apiToken.neverUsed'),
      },
      {
        id: 'createdBy',
        header: t('apiToken.field.createdBy'),
        enableSorting: false,
        cell: ({ row }) => row.original.createdBy?.displayName ?? '-',
      },
      {
        id: 'actions',
        header: t('common.actions'),
        enableSorting: false,
        cell: ({ row }) =>
          canRevoke &&
          row.original.status !== 'revoked' && (
            <Tooltip content={t('apiToken.revoke.action')}>
              <IconButton
                size="sm"
                aria-label={t('apiToken.revoke.action')}
                onClick={() =>
                  void confirm({
                    title: t('apiToken.revoke.title'),
                    description: t('apiToken.revoke.confirm', { name: row.original.name }),
                    confirmLabel: t('apiToken.revoke.action'),
                    tone: 'danger',
                    onConfirm: () => onRevoke(row.original),
                    'data-testid': 'api-token-revoke-confirm',
                  })
                }
                data-testid="api-token-revoke-button"
                data-value={row.original.id}
              >
                <Icon name="trash" size={16} />
              </IconButton>
            </Tooltip>
          ),
      },
    ],
    [canRevoke, confirm, onRevoke, t],
  );

  return (
    <Table
      data={tokens ?? []}
      columns={columns}
      loading={loading}
      getRowId={getRowId}
      emptyTitle={t('apiToken.empty')}
      data-testid={testId}
    />
  );
}

const getRowId = (token: ApiToken) => token.id;
