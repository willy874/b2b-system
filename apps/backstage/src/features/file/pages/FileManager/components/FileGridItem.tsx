import { Checkbox } from '@b2b-system/ui/Checkbox';
import { useTranslation } from '@b2b-system/web-core/locales';
import { cn } from '@b2b-system/web-shared/utils';
import { memo } from 'react';
import type { CSSProperties } from 'react';

import type { FileItemVM } from '../adapter';
import { FileThumbnail } from './FileThumbnail';

interface FileGridItemProps {
  item: FileItemVM;
  selected: boolean;
  focused: boolean;
  /** 已有選取時一律顯示勾選框（觸控裝置沒有 hover）。 */
  selecting: boolean;
  /** 有移動權限時可以拖到資料夾上。 */
  draggable: boolean;
  style: CSSProperties;
  onStaleUrl: () => void;
  /** 勾選框切換（穩定的參考：不因選取改變而讓所有項目重新渲染）。 */
  onToggle: (id: string) => void;
}

/**
 * 圖示卡片。點擊、雙擊、勾選由主區塊（`FileBrowser`）以事件委派處理：一萬張卡片不必各掛一組 handler，
 * 這裡只以 `data-file-item` / `data-id` 標出自己。
 */
export const FileGridItem = memo(function FileGridItem({
  item,
  selected,
  focused,
  selecting,
  draggable,
  style,
  onStaleUrl,
  onToggle,
}: FileGridItemProps) {
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
      data-testid="file-item"
      data-value={item.id}
      data-selected={selected || undefined}
      title={item.name}
      style={style}
      className={cn(
        'group absolute flex cursor-default flex-col overflow-hidden rounded-md border bg-[var(--color-surface)] select-none',
        selected
          ? 'border-[var(--color-brand)] ring-2 ring-[var(--color-brand)]'
          : 'border-[var(--color-border)] hover:border-[var(--color-fg-muted)]',
        focused && 'outline-2 outline-offset-2 outline-[var(--color-brand)]',
      )}
    >
      <div className="relative min-h-0 flex-1 bg-[var(--color-fill-subtle)]">
        <FileThumbnail item={item} variant="card" onStaleUrl={onStaleUrl} />
        <span
          data-file-checkbox=""
          className={cn(
            // flex：底襯貼齊勾選框；inline 排版會吃到行高，底襯被撐成直長方形
            'absolute top-1.5 left-1.5 flex rounded bg-[var(--color-surface)]',
            !selected && !selecting && 'opacity-0 group-hover:opacity-100 focus-within:opacity-100',
          )}
        >
          <Checkbox
            checked={selected}
            onCheckedChange={() => onToggle(item.id)}
            aria-label={t('file.select', { name: item.name })}
            data-testid="file-item-checkbox"
            // 取消與文字對齊用的 margin-top，否則底襯上方多出 2px
            classNames={{ control: 'mt-0' }}
          />
        </span>
      </div>
      <div className="flex flex-col gap-0.5 px-2 py-1.5">
        <span className="truncate text-sm font-medium">{item.name}</span>
        <span className="truncate text-xs text-[var(--color-fg-muted)]">{item.sizeLabel}</span>
      </div>
    </div>
  );
});
