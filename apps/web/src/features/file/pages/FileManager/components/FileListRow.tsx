import { memo } from 'react';
import type { CSSProperties, ReactNode } from 'react';

import { Checkbox } from '@/components/Checkbox';
import { useTranslation } from '@/core/locales';
import { formatDateTime } from '@/shared/date';
import { cn } from '@/shared/utils';

import { FILE_KIND_LABEL_KEY } from '../../../constants';
import type { FileItemVM } from '../adapter';
import type { FileListColumn } from '../layout';
import { FileThumbnail } from './FileThumbnail';

/** 各欄的寬度（CSS grid 的軌道）；表頭與資料列共用，欄位才會對齊。 */
export const LIST_COLUMN_TRACK = {
  name: 'minmax(0, 1fr)',
  kind: '8rem',
  size: '6rem',
  createdAt: '11rem',
  uploader: '9rem',
} as const satisfies Record<FileListColumn, string>;

/** 勾選欄 ＋ 顯示中的欄位。 */
export function listGridTemplate(columns: readonly FileListColumn[]): string {
  return ['2.5rem', ...columns.map((column) => LIST_COLUMN_TRACK[column])].join(' ');
}

interface FileListRowProps {
  item: FileItemVM;
  columns: readonly FileListColumn[];
  selected: boolean;
  focused: boolean;
  /** 有移動權限時可以拖到資料夾上。 */
  draggable: boolean;
  style: CSSProperties;
  onStaleUrl: () => void;
  /** 勾選框切換（穩定的參考：不因選取改變而讓所有項目重新渲染）。 */
  onToggle: (id: string) => void;
}

/** 列表的一列。互動同 `FileGridItem`，由主區塊委派處理。 */
export const FileListRow = memo(function FileListRow({
  item,
  columns,
  selected,
  focused,
  draggable,
  style,
  onStaleUrl,
  onToggle,
}: FileListRowProps) {
  const { t } = useTranslation();
  const cells: Record<FileListColumn, ReactNode> = {
    name: (
      <span className="flex min-w-0 items-center gap-2">
        <span className="size-8 shrink-0 overflow-hidden rounded bg-[var(--color-fill-subtle)]">
          <FileThumbnail item={item} variant="row" onStaleUrl={onStaleUrl} />
        </span>
        <span className="truncate font-medium">{item.name}</span>
      </span>
    ),
    kind: <span className="truncate">{t(FILE_KIND_LABEL_KEY[item.kind])}</span>,
    size: <span className="tabular-nums">{item.sizeLabel}</span>,
    createdAt: <span className="truncate">{formatDateTime(item.createdAt)}</span>,
    uploader: <span className="truncate">{item.uploaderName ?? '—'}</span>,
  };
  return (
    <div
      id={`file-item-${item.id}`}
      // listbox 的選項：點擊與鍵盤由容器（FileBrowser）委派處理；<option> 只能放在 <select> 裡，無法承載卡片內容
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
      role="option"
      aria-selected={selected}
      draggable={draggable}
      data-file-item=""
      data-id={item.id}
      data-testid="file-item"
      data-value={item.id}
      data-selected={selected || undefined}
      title={item.name}
      style={{ ...style, gridTemplateColumns: listGridTemplate(columns) }}
      className={cn(
        'absolute grid cursor-default items-center gap-3 border-b border-[var(--color-border)] px-3 text-sm select-none',
        selected ? 'bg-[var(--color-fill)]' : 'hover:bg-[var(--color-fill-subtle)]',
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
