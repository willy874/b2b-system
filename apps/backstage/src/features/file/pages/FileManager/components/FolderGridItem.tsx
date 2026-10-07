import { Checkbox } from '@b2b-system/ui/Checkbox';
import { Icon } from '@b2b-system/ui/Icon';
import { useTranslation } from '@b2b-system/web-core/locales';
import { cn } from '@b2b-system/web-shared/utils';
import { memo } from 'react';
import type { CSSProperties } from 'react';

import { FILE_FOLDER_KIND_ICON } from '../../../constants';
import type { FolderItemVM } from '../adapter';

interface FolderGridItemProps {
  item: FolderItemVM;
  selected: boolean;
  focused: boolean;
  /** 已有選取時一律顯示勾選框（觸控裝置沒有 hover）。 */
  selecting: boolean;
  /** 拖曳中的項目正停在這個資料夾上、而且可以放。 */
  dropOver: boolean;
  draggable: boolean;
  style: CSSProperties;
  onToggle: (id: string) => void;
}

/**
 * 圖示卡片排版的資料夾。點擊、雙擊（進入）、拖曳由主區塊（`FileBrowser`）以事件委派處理；
 * 這裡以 `data-file-item` 標出自己，並以 `data-drop-folder` 標成放置目標（移動、從電腦拖檔案上傳）。
 */
export const FolderGridItem = memo(function FolderGridItem({
  item,
  selected,
  focused,
  selecting,
  dropOver,
  draggable,
  style,
  onToggle,
}: FolderGridItemProps) {
  const { t } = useTranslation();
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
      data-drop-folder={item.id}
      data-testid="file-folder-item"
      data-value={item.id}
      data-selected={selected || undefined}
      data-drop-over={dropOver || undefined}
      data-locked={!item.canRead || undefined}
      title={
        item.canRead
          ? item.name
          : t('common.withNote', { name: item.name, note: t('file.access.locked') })
      }
      style={style}
      className={cn(
        'group absolute flex cursor-default flex-col overflow-hidden rounded-md border bg-[var(--color-surface)] select-none',
        selected
          ? 'border-[var(--color-brand)] ring-2 ring-[var(--color-brand)]'
          : 'border-[var(--color-border)] hover:border-[var(--color-fg-muted)]',
        dropOver &&
          'border-[var(--color-brand)] bg-[color-mix(in_srgb,var(--color-brand)_10%,var(--color-surface))] ring-2 ring-[var(--color-brand)]',
        focused && 'outline-2 outline-offset-2 outline-[var(--color-brand)]',
      )}
    >
      <div
        className={cn(
          'relative flex min-h-0 flex-1 items-center justify-center bg-[var(--color-fill-subtle)]',
          item.canRead ? 'text-[var(--color-brand)]' : 'text-[var(--color-fg-muted)]',
        )}
      >
        <Icon name={FILE_FOLDER_KIND_ICON[item.kind]} size={24} className="scale-150" />
        {!item.canRead && (
          // 鎖住的資料夾：看得到、進得去（子資料夾），看不到檔案（docs/architecture/iam/06-resource-grants.md §5.1）
          <span
            className="absolute right-1.5 bottom-1.5 flex rounded-full bg-[var(--color-surface)] p-1 text-[var(--color-fg-muted)] shadow-[var(--shadow-popover)]"
            data-testid="file-folder-locked"
          >
            <Icon name="lock" size={14} aria-label={t('file.access.locked')} />
          </span>
        )}
        <span
          data-file-checkbox=""
          className={cn(
            'absolute top-1.5 left-1.5 flex rounded bg-[var(--color-surface)]',
            !selected && !selecting && 'opacity-0 group-hover:opacity-100 focus-within:opacity-100',
          )}
        >
          <Checkbox
            checked={selected}
            onCheckedChange={() => onToggle(item.id)}
            aria-label={t('file.select', { name: item.name })}
            data-testid="file-item-checkbox"
            classNames={{ control: 'mt-0' }}
          />
        </span>
      </div>
      <div className="flex flex-col gap-0.5 px-2 py-1.5">
        <span className="truncate text-sm font-medium">{item.name}</span>
        <span className="truncate text-xs text-[var(--color-fg-muted)]">
          {!item.canRead
            ? t(item.hasPendingAccessRequest ? 'file.access.pending' : 'file.access.locked')
            : item.folderCount > 0
              ? t('file.folder.subfolders', { count: item.folderCount })
              : t('file.folder.label')}
        </span>
      </div>
    </div>
  );
});
