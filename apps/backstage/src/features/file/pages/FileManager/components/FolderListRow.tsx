import { Checkbox } from '@b2b-system/ui/Checkbox';
import { Icon } from '@b2b-system/ui/Icon';
import { useTranslation } from '@b2b-system/web-core/locales';
import { formatDateTime } from '@b2b-system/web-shared/date';
import { cn } from '@b2b-system/web-shared/utils';
import { memo } from 'react';
import type { CSSProperties, ReactNode } from 'react';

import { TagChips } from '@/core/components';

import { FILE_FOLDER_KIND_ICON } from '../../../constants';
import type { FolderItemVM } from '../adapter';
import type { FileListColumn } from '../layout';
import { listGridTemplate } from './FileListRow';

interface FolderListRowProps {
  item: FolderItemVM;
  columns: readonly FileListColumn[];
  selected: boolean;
  focused: boolean;
  dropOver: boolean;
  draggable: boolean;
  style: CSSProperties;
  onToggle: (id: string) => void;
}

/** 列表排版的資料夾。互動同 `FolderGridItem`，由主區塊委派處理。 */
export const FolderListRow = memo(function FolderListRow({
  item,
  columns,
  selected,
  focused,
  dropOver,
  draggable,
  style,
  onToggle,
}: FolderListRowProps) {
  const { t } = useTranslation();
  const cells: Record<FileListColumn, ReactNode> = {
    name: (
      <span className="flex min-w-0 items-center gap-2">
        <span
          className={cn(
            'flex size-8 shrink-0 items-center justify-center rounded bg-[var(--color-fill-subtle)]',
            item.canRead ? 'text-[var(--color-brand)]' : 'text-[var(--color-fg-muted)]',
          )}
        >
          <Icon
            name={item.canRead ? FILE_FOLDER_KIND_ICON[item.kind] : 'lock'}
            size={item.canRead ? 20 : 16}
          />
        </span>
        <span className="truncate font-medium">{item.name}</span>
        {!item.canRead && (
          <span
            className="shrink-0 text-xs text-[var(--color-fg-muted)]"
            data-testid="file-folder-locked"
          >
            {t(item.hasPendingAccessRequest ? 'file.access.pending' : 'file.access.locked')}
          </span>
        )}
      </span>
    ),
    tags: <TagChips tags={item.tags} max={2} className="min-w-0 flex-nowrap overflow-hidden" />,
    kind: <span className="truncate">{t('file.folder.label')}</span>,
    size: (
      <span className="truncate text-[var(--color-fg-muted)]">
        {item.folderCount > 0 ? t('file.folder.subfolders', { count: item.folderCount }) : '—'}
      </span>
    ),
    createdAt: <span className="truncate">{formatDateTime(item.updatedAt)}</span>,
    uploader: <span className="truncate">—</span>,
  };
  return (
    <div
      id={`file-item-${item.id}`}
      // listbox 的選項：點擊與鍵盤由容器（FileBrowser）委派處理
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
      role="option"
      aria-selected={selected}
      draggable={draggable}
      data-file-item=""
      data-id={item.id}
      data-drop-folder={item.id}
      data-testid="file-folder-item"
      data-value={item.id}
      data-selected={selected || undefined}
      data-drop-over={dropOver || undefined}
      title={item.name}
      style={{ ...style, gridTemplateColumns: listGridTemplate(columns) }}
      className={cn(
        'absolute grid cursor-default items-center gap-3 border-b border-[var(--color-border)] px-3 text-sm select-none',
        selected ? 'bg-[var(--color-fill)]' : 'hover:bg-[var(--color-fill-subtle)]',
        dropOver &&
          'bg-[color-mix(in_srgb,var(--color-brand)_12%,transparent)] outline-2 -outline-offset-2 outline-[var(--color-brand)]',
        focused && 'outline-2 -outline-offset-2 outline-[var(--color-brand)]',
      )}
    >
      <span data-file-checkbox="" className="flex items-center">
        <Checkbox
          checked={selected}
          onCheckedChange={() => onToggle(item.id)}
          aria-label={t('file.select', { name: item.name })}
          data-testid="file-item-checkbox"
        />
      </span>
      {columns.map((column) => (
        <span key={column} className="min-w-0 text-[var(--color-fg)]">
          {cells[column]}
        </span>
      ))}
    </div>
  );
});
