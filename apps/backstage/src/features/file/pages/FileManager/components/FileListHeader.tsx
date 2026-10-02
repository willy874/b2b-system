import type { FileSortField } from '@/apis/file/types';
import { Checkbox } from '@/components/Checkbox';
import { Icon } from '@/components/Icon';
import { useTranslation } from '@/core/locales';
import type { SortEntry } from '@/shared/constants';

import { FILE_SORT_FIELDS } from '../../../constants';
import type { FileListColumn } from '../layout';
import { listGridTemplate } from './FileListRow';

const COLUMN_LABEL_KEY = {
  name: 'file.field.name',
  tags: 'file.field.tags',
  kind: 'file.field.kind',
  size: 'file.field.size',
  createdAt: 'file.field.createdAt',
  uploader: 'file.field.uploader',
} as const satisfies Record<FileListColumn, string>;

const isSortable = (column: FileListColumn): column is FileSortField =>
  (FILE_SORT_FIELDS as readonly string[]).includes(column);

interface FileListHeaderProps {
  columns: readonly FileListColumn[];
  sort: SortEntry<FileSortField>;
  onSortChange: (sort: SortEntry<FileSortField>) => void;
  selectedCount: number;
  total: number;
  onToggleAll: (checked: boolean) => void;
}

/** 列表模式的表頭：點欄名排序（再點一次反向），勾選框全選／取消全選目前載入的檔案。 */
export function FileListHeader({
  columns,
  sort,
  onSortChange,
  selectedCount,
  total,
  onToggleAll,
}: FileListHeaderProps) {
  const { t } = useTranslation();
  return (
    <div
      role="presentation"
      className="grid h-9 shrink-0 items-center gap-3 border-b border-[var(--color-border)] bg-[var(--color-fill-subtle)] px-3 text-xs font-semibold text-[var(--color-fg-muted)]"
      style={{ gridTemplateColumns: listGridTemplate(columns) }}
      data-testid="file-list-header"
    >
      <Checkbox
        checked={total > 0 && selectedCount === total}
        indeterminate={selectedCount > 0 && selectedCount < total}
        onCheckedChange={onToggleAll}
        aria-label={t('file.selectAll')}
        data-testid="file-select-all"
      />
      {columns.map((column) => {
        const label = t(COLUMN_LABEL_KEY[column]);
        if (!isSortable(column)) return <span key={column}>{label}</span>;
        const active = sort.sort === column;
        return (
          <button
            key={column}
            type="button"
            className="flex items-center gap-1 text-left hover:text-[var(--color-fg)]"
            aria-label={
              active
                ? `${label}（${sort.order === 'asc' ? t('common.sortAsc') : t('common.sortDesc')}）`
                : label
            }
            onClick={() =>
              onSortChange({
                sort: column,
                order: active && sort.order === 'desc' ? 'asc' : active ? 'desc' : 'asc',
              })
            }
            data-testid="file-sort-header"
            data-value={column}
          >
            {label}
            {active && <Icon name={sort.order === 'asc' ? 'arrow-up' : 'arrow-down'} size={14} />}
          </button>
        );
      })}
    </div>
  );
}
