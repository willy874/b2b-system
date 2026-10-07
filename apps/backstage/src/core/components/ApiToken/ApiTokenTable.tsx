import { IconButton } from '@b2b-system/ui/Button';
import { Chip } from '@b2b-system/ui/Chip';
import { useConfirm } from '@b2b-system/ui/ConfirmDialog';
import { Icon } from '@b2b-system/ui/Icon';
import { Table } from '@b2b-system/ui/Table';
import type { TableColumnDef } from '@b2b-system/ui/Table';
import { Tooltip } from '@b2b-system/ui/Tooltip';
import { Text } from '@b2b-system/ui/Typography';
import { useTranslation } from '@b2b-system/web-core/locales';
import { formatDateTime, formatRelativeTime } from '@b2b-system/web-shared/date';
import { useMemo } from 'react';

import { useIsFeatureDisabled } from '@/core/feature';
import { TenantFeature } from '@/shared/api-sdk';
import type { ApiToken } from '@/shared/api-sdk';

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
 *
 * 租戶沒有啟用對外 API（`externalApi`，docs/architecture/06-external-api.md §3.1）時，token 照樣可以建立、撤銷，
 * 只在列表上方提示「目前呼叫不到」——三處 token 區塊都經過這裡，不必各自判斷。
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
  const externalApiDisabled = useIsFeatureDisabled(TenantFeature.externalApi);

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
    <>
      {externalApiDisabled && (
        <p
          role="note"
          className="m-0 text-sm text-[var(--color-warning-text)]"
          data-testid="api-token-external-api-disabled"
        >
          {t('apiToken.externalApiDisabled')}
        </p>
      )}
      <Table
        data={tokens ?? []}
        columns={columns}
        loading={loading}
        getRowId={getRowId}
        emptyTitle={t('apiToken.empty')}
        data-testid={testId}
      />
    </>
  );
}

const getRowId = (token: ApiToken) => token.id;
