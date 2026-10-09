import { Icon } from '@b2b-system/ui/Icon';
import { Spinner } from '@b2b-system/ui/Spinner';
import { useInfiniteScroll } from '@b2b-system/ui/VirtualList';
import { QueryError } from '@b2b-system/web-core/components';
import { useTranslation } from '@b2b-system/web-core/locales';
import type { SortEntry } from '@b2b-system/web-shared/constants';
import { cn } from '@b2b-system/web-shared/utils';
import { useEffect, useMemo, useState } from 'react';
import type { DragEvent, ReactNode } from 'react';

import type { FileSortField } from '@/apis/file/types';
import type { CollectedUpload } from '@/core/upload';

import type { FileViewMode } from '../../../preference';
import type { BrowserItemVM, BrowserSlot } from '../adapter';
import { computeFileLayout, itemRect, rowsTouchRange, withPlaceholders } from '../layout';
import { useBrowserKeyboard } from '../useBrowserKeyboard';
import { useBrowserPointer } from '../useBrowserPointer';
import { useBrowserRows } from '../useBrowserRows';
import { useElementSize } from '../useElementSize';
import { useFileDrop } from '../useFileDrop';
import type { FileSelection } from '../useFileSelection';
import type { ItemDrag } from '../useItemDrag';
import { useMarqueeSelection } from '../useMarqueeSelection';
import { FileBrowserItem } from './FileBrowserItem';
import { FileBrowserSkeleton } from './FileBrowserSkeleton';
import { FileListHeader } from './FileListHeader';

/** 無限捲動：離底部多遠（px）就先載下一頁，捲到底時資料多半已經到了。 */
const LOAD_MORE_THRESHOLD = 600;

interface FileBrowserProps {
  /** 資料夾在前、檔案在後。 */
  items: readonly BrowserItemVM[];
  viewMode: FileViewMode;
  selection: FileSelection;
  loading: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  /**
   * 無限捲動被 `maxPages` 丟掉的頁：在 `items` 的第 `at` 個之前保留 `count` 格佔位（docs/architecture/frontend/12-file-manager.md §5）。
   * 捲進佔位區時呼叫 `onLoadPrevious` 把它抓回來。
   */
  placeholder?: { at: number; count: number };
  loadingPrevious?: boolean;
  onLoadPrevious?: () => void;
  /** 開啟：資料夾是進入，檔案是 LightBox。 */
  onOpen: (item: BrowserItemVM) => void;
  onDeleteSelected: () => void;
  onStaleUrl: () => void;
  canUpload: boolean;
  /** 從電腦拖檔案或資料夾進來；`folderId` 是放在哪個資料夾卡片上（空白處是 undefined）。 */
  onDropUpload: (upload: CollectedUpload, folderId: string | undefined) => void;
  /** 所在的資料夾（拖曳項目的來源）；根目錄是 undefined。 */
  currentFolderId: string | undefined;
  /** 拖曳項目到資料夾上移動；`canMove` 為 false、或項目本身不能移動（`canUpdate`）時不可拖曳。 */
  itemDrag: ItemDrag;
  canMove: boolean;
  /** 能不能上傳到這個資料夾卡片（後端的 `capabilities.canCreate`）。 */
  canUploadInto: (folderId: string) => boolean;
  sort: SortEntry<FileSortField>;
  onSortChange: (sort: SortEntry<FileSortField>) => void;
  emptyContent: ReactNode;
  /** 列表查詢失敗：沒有任何項目時以錯誤與重試取代 `emptyContent`（不顯示「這個資料夾是空的」）。 */
  error?: unknown;
  onRetry?: () => void;
}

/**
 * 主區塊（docs/architecture/frontend/12-file-manager.md §3、§7）：
 * - 兩種排版（圖示卡片／列表）共用同一套固定尺寸的版面計算，依容器寬度自動調整欄數（RWD）
 * - 虛擬捲動：只渲染看得到的列
 * - 框選、點擊（Shift / Ctrl / ⌘）、鍵盤（方向鍵、空白鍵、Enter、Ctrl+A、Esc、Delete）選取
 * - 拖放上傳（檔案與資料夾，放在資料夾卡片上就傳到那個資料夾）
 * - 拖曳項目到資料夾卡片上移動（docs/architecture/frontend/12-file-manager.md §12）
 *
 * 項目的點擊以事件委派處理（listbox 模式：容器可聚焦、以 `aria-activedescendant` 指向焦點項目），
 * 不在每一格掛 handler。列與虛擬捲動在 `useBrowserRows`、鍵盤在 `useBrowserKeyboard`、
 * 點擊與拖曳在 `useBrowserPointer`；這裡只組裝與渲染。
 */
export function FileBrowser({
  items,
  viewMode,
  selection,
  loading,
  hasMore,
  loadingMore,
  onLoadMore,
  placeholder,
  loadingPrevious = false,
  onLoadPrevious,
  onOpen,
  onDeleteSelected,
  onStaleUrl,
  canUpload,
  onDropUpload,
  currentFolderId,
  itemDrag,
  canMove,
  canUploadInto,
  sort,
  onSortChange,
  emptyContent,
  error,
  onRetry,
}: FileBrowserProps) {
  const { t } = useTranslation();
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null);
  const { width } = useElementSize(scrollElement);
  // 版面以「格」計算：被丟掉的頁留下等量的佔位，丟頁、抓回來時其他項目的位置不變
  const placeholderAt = placeholder?.at ?? 0;
  const placeholderCount = placeholder?.count ?? 0;
  const slots: readonly BrowserSlot[] = useMemo(
    () => withPlaceholders(items, placeholderAt, placeholderCount),
    [items, placeholderAt, placeholderCount],
  );
  const layout = useMemo(
    () => computeFileLayout(viewMode, width, slots.length),
    [slots.length, viewMode, width],
  );
  const ids = useMemo(() => slots.map((item) => item?.id), [slots]);
  const { rows, contentHeight, scrollToIndex } = useBrowserRows(
    scrollElement,
    layout,
    placeholderCount > 0,
  );
  const { focusIndex, focused, setFocusIndex, onKeyDown } = useBrowserKeyboard({
    items: slots,
    layout,
    selection,
    currentFolderId,
    onOpen,
    onDeleteSelected,
    scrollToIndex,
  });

  const { marquee, onPointerDown: onMarqueeDown } = useMarqueeSelection({
    scrollElement,
    layout,
    ids,
    selection,
    enabled: !loading,
  });
  const { onPointerDown, onClick, onDoubleClick, onDragStart, onToggle } = useBrowserPointer({
    items: slots,
    selection,
    setFocusIndex,
    onOpen,
    onMarqueeDown,
    currentFolderId,
    itemDrag,
    canMove,
  });

  const {
    isDragging,
    overFolder,
    dropHandlers: uploadDrop,
  } = useFileDrop({
    enabled: canUpload || items.some((item) => item.type === 'folder' && item.canCreate),
    canDropInto: (folderId) => (folderId ? canUploadInto(folderId) : canUpload),
    onDrop: onDropUpload,
  });
  const overFolderName = overFolder
    ? items.find((item) => item.id === overFolder)?.name
    : undefined;
  // 兩種拖曳各自只認自己的資料型別（電腦的檔案 / 頁面內的項目），同一個容器上依序交給兩邊
  const dropHandlers = {
    onDragEnter: uploadDrop.onDragEnter,
    onDragOver: (event: DragEvent) => {
      uploadDrop.onDragOver(event);
      itemDrag.dropHandlers.onDragOver(event);
    },
    onDragLeave: (event: DragEvent) => {
      uploadDrop.onDragLeave(event);
      itemDrag.dropHandlers.onDragLeave(event);
    },
    onDrop: (event: DragEvent) => {
      uploadDrop.onDrop(event);
      itemDrag.dropHandlers.onDrop(event);
    },
  };

  // 無限捲動（同 VirtualList）：接近底部就載下一頁；內容不滿一屏時自動連續載到填滿
  const { onScroll } = useInfiniteScroll({
    scrollElement,
    count: slots.length,
    hasMore,
    loading: loadingMore,
    onLoadMore,
    threshold: LOAD_MORE_THRESHOLD,
  });

  // 渲染中的列（含 overscan）碰到佔位：把前一頁抓回來
  const placeholderVisible = rowsTouchRange(
    rows.map((row) => row.index),
    layout.columns,
    placeholderAt,
    placeholderCount,
  );
  useEffect(() => {
    if (placeholderVisible && !loadingPrevious) onLoadPrevious?.();
  }, [loadingPrevious, onLoadPrevious, placeholderVisible]);

  const selecting = selection.selected.size > 0;
  const showEmpty = !loading && items.length === 0;

  return (
    <div
      className="relative flex h-full flex-col overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]"
      data-testid="file-browser"
      data-view={viewMode}
      {...dropHandlers}
    >
      {viewMode === 'list' && (
        <FileListHeader
          columns={layout.listColumns}
          sort={sort}
          onSortChange={onSortChange}
          selectedCount={selection.selected.size}
          total={items.length}
          onToggleAll={(checked) => (checked ? selection.selectAll() : selection.clear())}
        />
      )}
      <div
        ref={setScrollElement}
        // 多選的網格清單（WAI-ARIA listbox ＋ aria-activedescendant）；<select> 無法承載卡片與虛擬捲動
        // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
        role="listbox"
        aria-multiselectable
        aria-label={t('file.browser.label')}
        aria-activedescendant={focused ? `file-item-${focused.id}` : undefined}
        tabIndex={0}
        className="relative min-h-0 flex-1 overflow-auto outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)] focus-visible:ring-inset"
        onPointerDown={onPointerDown}
        onScroll={onScroll}
        onClick={onClick}
        onDoubleClick={onDoubleClick}
        onKeyDown={onKeyDown}
        onDragStart={onDragStart}
        onDragEnd={itemDrag.endDrag}
        data-testid="file-browser-scroll"
      >
        {loading ? (
          <FileBrowserSkeleton viewMode={viewMode} />
        ) : (
          <div className="relative w-full" style={{ height: Math.max(0, contentHeight) }}>
            {rows.map((row) =>
              Array.from({ length: layout.columns }, (_, column) => {
                const index = row.index * layout.columns + column;
                const item = slots[index];
                if (!item) return null;
                const rect = itemRect(layout, index);
                return (
                  <FileBrowserItem
                    key={item.id}
                    item={item}
                    viewMode={viewMode}
                    columns={layout.listColumns}
                    selected={selection.selected.has(item.id)}
                    focused={index === focusIndex}
                    selecting={selecting}
                    dropOver={
                      item.type === 'folder' && (itemDrag.isOver(item.id) || overFolder === item.id)
                    }
                    draggable={canMove && item.canUpdate}
                    style={{
                      left: rect.left,
                      top: row.start,
                      width: rect.width,
                      height: rect.height,
                    }}
                    onStaleUrl={onStaleUrl}
                    onToggle={onToggle}
                  />
                );
              }),
            )}
            {marquee && (
              <div
                aria-hidden
                className="pointer-events-none absolute rounded-sm border border-[var(--color-brand)] bg-[color-mix(in_srgb,var(--color-brand)_12%,transparent)]"
                style={marquee}
                data-testid="file-marquee"
              />
            )}
          </div>
        )}
        {showEmpty && (
          <div className="absolute inset-0 flex items-center justify-center p-6">
            {error ? (
              <QueryError error={error} onRetry={onRetry} data-testid="file-browser-error" />
            ) : (
              emptyContent
            )}
          </div>
        )}
        {loadingMore && (
          <div className="flex justify-center py-3" data-testid="file-browser-loading-more">
            <Spinner size={16} label={t('common.loading')} />
          </div>
        )}
      </div>
      {isDragging && (
        <div
          className={cn(
            'pointer-events-none absolute inset-0 z-10 flex flex-col items-center gap-2 rounded-lg border-2 border-dashed border-[var(--color-brand)] text-[var(--color-brand)]',
            // 停在資料夾上時不遮住卡片（要看得到亮起來的是哪一個），提示移到底部
            overFolderName
              ? 'justify-end pb-4'
              : 'justify-center bg-[color-mix(in_srgb,var(--color-surface)_85%,transparent)]',
          )}
          data-testid="file-drop-overlay"
          data-value={overFolder}
        >
          <Icon name="upload" size={24} />
          <span className="rounded-md bg-[var(--color-surface)] px-2 py-0.5 text-sm font-medium">
            {overFolderName
              ? t('file.upload.dropHintFolder', { name: overFolderName })
              : t('file.upload.dropHint')}
          </span>
        </div>
      )}
    </div>
  );
}
