import { IconButton } from '@b2b-system/ui/Button';
import { Chip } from '@b2b-system/ui/Chip';
import { useConfirm } from '@b2b-system/ui/ConfirmDialog';
import { Icon } from '@b2b-system/ui/Icon';
import type { TableColumnDef } from '@b2b-system/ui/Table';
import { Tooltip } from '@b2b-system/ui/Tooltip';
import { formatDateTime } from '@b2b-system/web-shared/date';
import { useMemo } from 'react';
import type { ReactNode } from 'react';

import { RichTable } from '../components';
import type { RichTablePagination } from '../components';
import { useErrorToast } from '../errors';
import { useTranslation } from '../locales';
import {
  ACTIVE_TRANSFER_STATUSES,
  EXPORT_FORMAT_LABEL_KEY,
  IMPORT_MODE_LABEL_KEY,
  TRANSFER_DIRECTION_LABEL_KEY,
  TRANSFER_STATUS_LABEL_KEY,
  TRANSFER_STATUS_TONE,
} from './constants';
import type { TransferView } from './types';

export interface TransferTableProps {
  items: TransferView[];
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  /** 沒有時不分頁、不延展填滿高度（例：列表上方「通知裡的這一筆」）。 */
  pagination?: RichTablePagination;
  /** 資源類型 → 顯示名稱（`GET /data-transfers/resources`）；沒有時顯示類型代碼。 */
  resourceLabel: (type: string) => string;
  onDownload: (transfer: TransferView) => Promise<unknown>;
  onCancel: (transfer: TransferView) => Promise<unknown>;
  onDelete: (transfer: TransferView) => Promise<unknown>;
  /** 匯入完成後「查看結果」的連結（到該資源的匯入頁，帶 `transfer`）；app 以 RouteLink 產生。 */
  renderResultLink: (transfer: TransferView) => ReactNode;
  'data-testid'?: string;
}

/**
 * 我的匯入匯出（docs/architecture/backend/22-data-transfer.md §8.4）：只列自己的傳輸；動作依狀態——
 * 匯出完成 → 下載，進行中 → 取消，匯入完成 → 查看結果，已結束 → 刪除。進度靠推播更新。
 */
export function TransferTable({
  items,
  loading,
  error,
  onRetry,
  pagination,
  resourceLabel,
  onDownload,
  onCancel,
  onDelete,
  renderResultLink,
  'data-testid': testId = 'data-transfer-table',
}: TransferTableProps) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const showError = useErrorToast();

  const columns = useMemo<Array<TableColumnDef<TransferView>>>(() => {
    const reportError = (failure: unknown): never => {
      showError(failure);
      throw failure;
    };
    return [
      {
        id: 'createdAt',
        header: t('dataTransfer.list.createdAt'),
        enableSorting: false,
        cell: ({ row }) => formatDateTime(row.original.createdAt),
      },
      {
        id: 'direction',
        header: t('dataTransfer.list.direction'),
        enableSorting: false,
        cell: ({ row }) => (
          <span className="flex flex-col">
            <span>{t(TRANSFER_DIRECTION_LABEL_KEY[row.original.direction])}</span>
            <span className="text-xs text-[var(--color-fg-muted)]">
              {row.original.mode
                ? t(IMPORT_MODE_LABEL_KEY[row.original.mode])
                : t(EXPORT_FORMAT_LABEL_KEY[row.original.format])}
            </span>
          </span>
        ),
      },
      {
        id: 'resource',
        header: t('dataTransfer.list.resource'),
        enableSorting: false,
        cell: ({ row }) => (
          <span className="flex flex-col">
            <span>{resourceLabel(row.original.type)}</span>
            <span className="text-xs text-[var(--color-fg-muted)]">
              {row.original.outputName ?? row.original.sourceName ?? ''}
            </span>
          </span>
        ),
      },
      {
        id: 'status',
        header: t('dataTransfer.list.status'),
        enableSorting: false,
        cell: ({ row }) => (
          <Chip
            tone={TRANSFER_STATUS_TONE[row.original.status]}
            data-testid="data-transfer-status"
            data-value={row.original.status}
          >
            {t(TRANSFER_STATUS_LABEL_KEY[row.original.status])}
          </Chip>
        ),
      },
      {
        id: 'rows',
        header: t('dataTransfer.list.rows'),
        enableSorting: false,
        cell: ({ row }) =>
          row.original.direction === 'export'
            ? t('dataTransfer.list.rowsExport', { rows: row.original.totalRows.toLocaleString() })
            : t('dataTransfer.list.rowsImport', {
                succeeded: row.original.succeededRows,
                failed: row.original.failedRows,
                skipped: row.original.skippedRows,
              }),
      },
      {
        id: 'expiresAt',
        header: t('dataTransfer.list.expiresAt'),
        enableSorting: false,
        cell: ({ row }) =>
          ACTIVE_TRANSFER_STATUSES.has(row.original.status) || row.original.status === 'expired'
            ? '—'
            : formatDateTime(row.original.expiresAt),
      },
      {
        id: 'actions',
        header: t('common.actions'),
        enableSorting: false,
        cell: ({ row }) => {
          const transfer = row.original;
          const active = ACTIVE_TRANSFER_STATUSES.has(transfer.status);
          return (
            <div className="flex items-center gap-1">
              {transfer.direction === 'export' &&
                transfer.status === 'completed' &&
                transfer.totalRows > 0 && (
                  <Tooltip content={t('dataTransfer.list.download')}>
                    <IconButton
                      size="sm"
                      aria-label={t('dataTransfer.list.download')}
                      onClick={() => void onDownload(transfer).catch(showError)}
                      data-testid="data-transfer-download"
                      data-value={transfer.id}
                    >
                      <Icon name="download" size={16} />
                    </IconButton>
                  </Tooltip>
                )}
              {transfer.direction === 'import' &&
                !active &&
                transfer.status !== 'expired' &&
                renderResultLink(transfer)}
              {active && (
                <Tooltip content={t('dataTransfer.list.cancel')}>
                  <IconButton
                    size="sm"
                    aria-label={t('dataTransfer.list.cancel')}
                    onClick={() =>
                      void confirm({
                        title: t('dataTransfer.list.cancelTitle'),
                        description: t('dataTransfer.list.cancelDescription'),
                        confirmLabel: t('dataTransfer.list.cancel'),
                        tone: 'danger',
                        onConfirm: () => onCancel(transfer).catch(reportError),
                      })
                    }
                    data-testid="data-transfer-cancel"
                    data-value={transfer.id}
                  >
                    <Icon name="close" size={16} />
                  </IconButton>
                </Tooltip>
              )}
              {!active && (
                <Tooltip content={t('dataTransfer.list.delete')}>
                  <IconButton
                    size="sm"
                    aria-label={t('dataTransfer.list.delete')}
                    onClick={() =>
                      void confirm({
                        title: t('dataTransfer.list.deleteTitle'),
                        description: t('dataTransfer.list.deleteDescription'),
                        confirmLabel: t('dataTransfer.list.delete'),
                        tone: 'danger',
                        onConfirm: () => onDelete(transfer).catch(reportError),
                      })
                    }
                    data-testid="data-transfer-delete"
                    data-value={transfer.id}
                  >
                    <Icon name="trash" size={16} />
                  </IconButton>
                </Tooltip>
              )}
            </div>
          );
        },
      },
    ];
  }, [confirm, onCancel, onDelete, onDownload, renderResultLink, resourceLabel, showError, t]);

  return (
    <RichTable
      data={items}
      columns={columns}
      loading={loading}
      error={error}
      onRetry={onRetry}
      getRowId={(row) => row.id}
      enableRowSelection={false}
      enableRowPinning={false}
      pagination={pagination}
      fillHeight={pagination !== undefined}
      emptyTitle={t('dataTransfer.list.empty')}
      data-testid={testId}
    />
  );
}
