import { IconButton } from '@b2b-system/ui/Button';
import { Chip } from '@b2b-system/ui/Chip';
import { Icon } from '@b2b-system/ui/Icon';
import type { TableColumnDef } from '@b2b-system/ui/Table';
import { Tooltip } from '@b2b-system/ui/Tooltip';
import { RichTable } from '@b2b-system/web-core/components';
import type { TableSearchProps, TableSettingsConfig } from '@b2b-system/web-core/components';
import { useTranslation } from '@b2b-system/web-core/locales';
import { formatDateTime } from '@b2b-system/web-shared/date';
import { useMemo } from 'react';

import {
  PLATFORM_ADMIN_ROLE_LABEL_KEY,
  PLATFORM_ADMIN_ROLE_TONE,
  PLATFORM_ADMIN_STATUS_LABEL_KEY,
  PLATFORM_ADMIN_STATUS_TONE,
} from '../../../constants';
import { PLATFORM_ADMIN_LIST_TABLE_ID } from '../../../preference';
import type { PlatformAdminRowVM } from '../adapter';

/** 欄位順序與顯示存在這台裝置（`core/store/tableColumnSettings`）；可設定的欄位登記在 `preference.ts`。 */
const PLATFORM_ADMIN_TABLE_SETTINGS: TableSettingsConfig = {
  tableId: PLATFORM_ADMIN_LIST_TABLE_ID,
};

interface PlatformAdminTableProps {
  rows: PlatformAdminRowVM[];
  loading: boolean;
  /** `platformAdmin:update`：編輯、寄設定密碼連結（未水合時為 false，不閃現按鈕）。 */
  canUpdate: boolean;
  onEdit: (row: PlatformAdminRowVM) => void;
  onSendPasswordLink: (row: PlatformAdminRowVM) => void;
  /** 表格上方常駐的關鍵字搜尋。 */
  searchBox: TableSearchProps;
  /** 列表查詢失敗（顯示錯誤與重試，不落到「沒有資料」）。 */
  error: unknown;
  onRetry: () => void;
}

export function PlatformAdminTable({
  rows,
  loading,
  canUpdate,
  onEdit,
  onSendPasswordLink,
  searchBox,
  error,
  onRetry,
}: PlatformAdminTableProps) {
  const { t } = useTranslation();

  const columns = useMemo<Array<TableColumnDef<PlatformAdminRowVM>>>(
    () => [
      {
        id: 'displayName',
        header: t('platformAdmin.field.displayName'),
        enableSorting: false,
        cell: ({ row }) => (
          <span className="inline-flex items-center gap-2">
            <span className="font-medium">{row.original.displayName}</span>
            {row.original.isSelf && (
              <Chip tone="brand" data-testid="platform-admin-self">
                {t('platformAdmin.self')}
              </Chip>
            )}
          </span>
        ),
      },
      {
        id: 'email',
        header: t('platformAdmin.field.email'),
        enableSorting: false,
        cell: ({ row }) => (
          <span data-testid="platform-admin-email" data-value={row.original.email}>
            {row.original.email}
          </span>
        ),
      },
      {
        id: 'role',
        header: t('platformAdmin.field.role'),
        enableSorting: false,
        cell: ({ row }) => (
          <Chip
            tone={PLATFORM_ADMIN_ROLE_TONE[row.original.role]}
            data-testid="platform-admin-role"
            data-value={row.original.role}
          >
            {t(PLATFORM_ADMIN_ROLE_LABEL_KEY[row.original.role])}
          </Chip>
        ),
      },
      {
        id: 'status',
        header: t('platformAdmin.field.status'),
        enableSorting: false,
        cell: ({ row }) => (
          <Chip
            tone={PLATFORM_ADMIN_STATUS_TONE[row.original.status]}
            data-testid="platform-admin-status"
            data-value={row.original.status}
          >
            {t(PLATFORM_ADMIN_STATUS_LABEL_KEY[row.original.status])}
          </Chip>
        ),
      },
      {
        id: 'lastLoginAt',
        header: t('platformAdmin.field.lastLoginAt'),
        enableSorting: false,
        cell: ({ row }) =>
          row.original.lastLoginAt ? formatDateTime(row.original.lastLoginAt) : '-',
      },
      {
        id: 'actions',
        header: t('common.actions'),
        enableSorting: false,
        cell: ({ row }) =>
          canUpdate && (
            <div className="flex gap-1">
              <Tooltip content={t('platformAdmin.edit.action')}>
                <IconButton
                  size="sm"
                  aria-label={t('platformAdmin.edit.action')}
                  onClick={() => onEdit(row.original)}
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
                  onClick={() => onSendPasswordLink(row.original)}
                  data-testid="platform-admin-password-link"
                  data-value={row.original.email}
                >
                  <Icon name="key" size={16} />
                </IconButton>
              </Tooltip>
            </div>
          ),
      },
    ],
    [canUpdate, onEdit, onSendPasswordLink, t],
  );

  return (
    <RichTable
      data={rows}
      columns={columns}
      loading={loading}
      getRowId={getRowId}
      search={searchBox}
      error={error}
      onRetry={onRetry}
      settings={PLATFORM_ADMIN_TABLE_SETTINGS}
      // 沒有批次操作：不提供勾選欄
      enableRowSelection={false}
      // 有關鍵字時交給 RichTable 顯示「沒有符合條件」＋清除
      emptyTitle={searchBox.value ? undefined : t('platformAdmin.empty')}
      onRowDoubleClick={canUpdate ? onEdit : undefined}
      data-testid="platform-admin-table"
    />
  );
}

const getRowId = (row: PlatformAdminRowVM) => row.id;
