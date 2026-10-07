import { IconButton } from '@b2b-system/ui/Button';
import { Icon } from '@b2b-system/ui/Icon';
import type { TableColumnDef } from '@b2b-system/ui/Table';
import { Tooltip } from '@b2b-system/ui/Tooltip';
import { RichTable } from '@b2b-system/web-core/components';
import { useTranslation } from '@b2b-system/web-core/locales';
import { formatDateTime } from '@b2b-system/web-shared/date';
import { useMemo } from 'react';

import { TagChips } from '@/core/components';
import type { Tag } from '@/shared/api-sdk';

import { TAG_COLOR_LABEL_KEY } from '../../../constants';

interface TagTableProps {
  items: Tag[];
  loading: boolean;
  /** 查詢失敗：沒有資料時以錯誤與重試取代表格 */
  error: unknown;
  onRetry: () => void;
  canUpdate: boolean;
  canDelete: boolean;
  /** 要穩定的參照（列的操作在 useMemo 裡） */
  onEdit: (tag: Tag) => void;
  onDelete: (tag: Tag) => void;
}

const getRowId = (row: Tag) => row.id;

/** 一個標籤組的標籤：名稱（以 Chip 顯示）、顏色、更新時間與編輯／刪除。 */
export function TagTable({
  items,
  loading,
  error,
  onRetry,
  canUpdate,
  canDelete,
  onEdit,
  onDelete,
}: TagTableProps) {
  const { t } = useTranslation();
  const columns = useMemo<Array<TableColumnDef<Tag>>>(
    () => [
      {
        id: 'name',
        header: t('tagAdmin.field.name'),
        enableSorting: false,
        cell: ({ row }) => <TagChips tags={[row.original]} />,
      },
      {
        id: 'color',
        header: t('tagAdmin.field.color'),
        enableSorting: false,
        cell: ({ row }) => t(TAG_COLOR_LABEL_KEY[row.original.color]),
      },
      {
        id: 'updatedAt',
        header: t('tagAdmin.field.updatedAt'),
        enableSorting: false,
        cell: ({ row }) => formatDateTime(row.original.updatedAt),
      },
      {
        id: 'actions',
        header: t('common.actions'),
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex gap-1">
            {canUpdate && (
              <Tooltip content={t('common.edit')}>
                <IconButton
                  size="sm"
                  aria-label={t('common.edit')}
                  onClick={() => onEdit(row.original)}
                  data-testid="tag-edit-button"
                  data-value={row.original.id}
                >
                  <Icon name="edit" size={16} />
                </IconButton>
              </Tooltip>
            )}
            {canDelete && (
              <Tooltip content={t('common.delete')}>
                <IconButton
                  size="sm"
                  aria-label={t('common.delete')}
                  onClick={() => onDelete(row.original)}
                  data-testid="tag-delete-button"
                  data-value={row.original.id}
                >
                  <Icon name="trash" size={16} />
                </IconButton>
              </Tooltip>
            )}
          </div>
        ),
      },
    ],
    [canDelete, canUpdate, onDelete, onEdit, t],
  );

  return (
    <RichTable
      data={items}
      columns={columns}
      loading={loading}
      getRowId={getRowId}
      enableRowSelection={false}
      error={error}
      onRetry={onRetry}
      data-testid="tag-table"
    />
  );
}
