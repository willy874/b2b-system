import { useVirtualizer } from '@tanstack/react-virtual';
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, MouseEvent, PointerEvent, ReactNode } from 'react';

import type { FileSortField } from '@/apis/file/types';
import { Icon } from '@/components/Icon';
import { Skeleton } from '@/components/Skeleton';
import { Spinner } from '@/components/Spinner';
import { useInfiniteScroll } from '@/components/VirtualList';
import { useTranslation } from '@/core/locales';
import type { SortEntry } from '@/shared/constants';

import type { FileViewMode } from '../../../preference';
import type { FileItemVM } from '../adapter';
import { computeFileLayout, itemRect, moveIndex } from '../layout';
import { useElementSize } from '../useElementSize';
import { useFileDrop } from '../useFileDrop';
import type { FileSelection } from '../useFileSelection';
import { useMarqueeSelection } from '../useMarqueeSelection';
import { FileGridItem } from './FileGridItem';
import { FileListHeader } from './FileListHeader';
import { FileListRow } from './FileListRow';

/** 列數在這以下不虛擬化：全部渲染（測試環境沒有版面，也靠它看得到項目）。 */
const VIRTUAL_THRESHOLD_ROWS = 40;
/** 無限捲動：離底部多遠（px）就先載下一頁，捲到底時資料多半已經到了。 */
const LOAD_MORE_THRESHOLD = 600;

type NavigationKey = 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight' | 'Home' | 'End';
const NAVIGATION_KEYS: ReadonlySet<string> = new Set([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Home',
  'End',
]);

interface FileBrowserProps {
  items: readonly FileItemVM[];
  viewMode: FileViewMode;
  selection: FileSelection;
  loading: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  onOpen: (id: string) => void;
  onDeleteSelected: () => void;
  onStaleUrl: () => void;
  canUpload: boolean;
  onDropFiles: (files: File[]) => void;
  onDropDirectories: (count: number) => void;
  sort: SortEntry<FileSortField>;
  onSortChange: (sort: SortEntry<FileSortField>) => void;
  emptyContent: ReactNode;
}

/**
 * 主區塊（docs/architecture/frontend/12-file-manager.md §3、§7）：
 * - 兩種排版（圖示卡片／列表）共用同一套固定尺寸的版面計算，依容器寬度自動調整欄數（RWD）
 * - 虛擬捲動：只渲染看得到的列
 * - 框選、點擊（Shift / Ctrl / ⌘）、鍵盤（方向鍵、空白鍵、Enter、Ctrl+A、Esc、Delete）選取
 * - 拖放檔案上傳
 *
 * 項目的點擊以事件委派處理（listbox 模式：容器可聚焦、以 `aria-activedescendant` 指向焦點項目），
 * 不在每一格掛 handler。
 */
export function FileBrowser({
  items,
  viewMode,
  selection,
  loading,
  hasMore,
  loadingMore,
  onLoadMore,
  onOpen,
  onDeleteSelected,
  onStaleUrl,
  canUpload,
  onDropFiles,
  onDropDirectories,
  sort,
  onSortChange,
  emptyContent,
}: FileBrowserProps) {
  const { t } = useTranslation();
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null);
  const { width } = useElementSize(scrollElement);
  const layout = useMemo(
    () => computeFileLayout(viewMode, width, items.length),
    [items.length, viewMode, width],
  );
  const ids = useMemo(() => items.map((item) => item.id), [items]);
  const [focusIndex, setFocusIndex] = useState(-1);
  const focused = items[focusIndex];

  const virtualize = layout.rowCount > VIRTUAL_THRESHOLD_ROWS;
  // oxlint-disable-next-line react/incompatible-library -- TanStack Virtual 回傳可變物件；這個元件不依賴 React Compiler 的記憶化
  const virtualizer = useVirtualizer({
    count: layout.rowCount,
    getScrollElement: () => scrollElement,
    estimateSize: () => layout.rowStride,
    paddingStart: layout.padding,
    paddingEnd: layout.padding,
    overscan: 3,
    enabled: virtualize,
    // 預設以 flushSync 更新，會在我們於 layout effect 裡呼叫 measure() 時觸發 React 警告；捲動時的非同步更新夠快
    useFlushSync: false,
  });
  // 欄數或列高隨寬度改變：丟掉舊的量測，重新以新的列高計算
  useLayoutEffect(() => {
    virtualizer.measure();
  }, [layout.rowStride, layout.columns, virtualizer]);

  const rows = virtualize
    ? virtualizer.getVirtualItems().map((row) => ({ index: row.index, start: row.start }))
    : Array.from({ length: layout.rowCount }, (_, index) => ({
        index,
        start: layout.padding + index * layout.rowStride,
      }));
  const contentHeight = virtualize
    ? virtualizer.getTotalSize()
    : layout.padding * 2 + layout.rowCount * layout.rowStride - layout.gap;

  const { marquee, onPointerDown: onMarqueeDown } = useMarqueeSelection({
    scrollElement,
    layout,
    ids,
    selection,
    enabled: !loading,
  });

  const { isDragging, dropHandlers } = useFileDrop({
    enabled: canUpload,
    onFiles: onDropFiles,
    onDirectories: onDropDirectories,
  });

  // 無限捲動（同 VirtualList）：接近底部就載下一頁；內容不滿一屏時自動連續載到填滿
  const { onScroll } = useInfiniteScroll({
    scrollElement,
    count: items.length,
    hasMore,
    loading: loadingMore,
    onLoadMore,
    threshold: LOAD_MORE_THRESHOLD,
  });

  const lastPointerType = useRef<string>('mouse');
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    lastPointerType.current = event.pointerType;
    onMarqueeDown(event);
  };

  const itemFromEvent = (event: MouseEvent) => {
    const element = (event.target as Element).closest<HTMLElement>('[data-file-item]');
    const id = element?.dataset.id;
    return id ? { id, index: ids.indexOf(id) } : undefined;
  };

  // 勾選框由它自己的 onCheckedChange 切換；以 ref 保持參考穩定，選取改變時項目不必全部重新渲染
  const toggleRef = useRef(selection.click);
  useLayoutEffect(() => {
    toggleRef.current = selection.click;
  });
  const onToggle = useCallback((id: string) => toggleRef.current(id, { toggle: true }), []);

  const onClick = (event: MouseEvent<HTMLDivElement>) => {
    const hit = itemFromEvent(event);
    if (!hit) return;
    setFocusIndex(hit.index);
    // 勾選框（含 Base UI 轉發給隱藏 input 的第二次 click）已由 onToggle 處理
    if ((event.target as Element).closest('[data-file-checkbox]')) return;
    // 觸控：還沒有選取時點一下就打開（沒有雙擊）；進入選取後點一下是切換
    if (lastPointerType.current === 'touch') {
      if (selection.selected.size === 0) onOpen(hit.id);
      else selection.click(hit.id, { toggle: true });
      return;
    }
    selection.click(hit.id, { shift: event.shiftKey, toggle: event.metaKey || event.ctrlKey });
  };

  const onDoubleClick = (event: MouseEvent<HTMLDivElement>) => {
    const hit = itemFromEvent(event);
    if (hit && !(event.target as Element).closest('[data-file-checkbox]')) onOpen(hit.id);
  };

  const scrollToIndex = useCallback(
    (index: number) => {
      if (!scrollElement) return;
      const row = Math.floor(index / layout.columns);
      if (virtualize) {
        virtualizer.scrollToIndex(row, { align: 'auto' });
        return;
      }
      const rect = itemRect(layout, index);
      const top = scrollElement.scrollTop;
      if (rect.top < top) scrollElement.scrollTop = rect.top - layout.padding;
      else if (rect.top + rect.height > top + scrollElement.clientHeight) {
        scrollElement.scrollTop =
          rect.top + rect.height + layout.padding - scrollElement.clientHeight;
      }
    },
    [layout, scrollElement, virtualize, virtualizer],
  );

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    if (NAVIGATION_KEYS.has(event.key)) {
      event.preventDefault();
      const next = moveIndex(layout, focusIndex, event.key as NavigationKey, items.length);
      const id = ids[next];
      if (id === undefined) return;
      setFocusIndex(next);
      scrollToIndex(next);
      if (event.shiftKey) selection.click(id, { shift: true });
      else if (!(event.metaKey || event.ctrlKey)) selection.click(id);
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      selection.selectAll();
      return;
    }
    switch (event.key) {
      case ' ':
        if (focused) {
          event.preventDefault();
          selection.click(focused.id, { toggle: true });
        }
        return;
      case 'Enter':
        if (focused) {
          event.preventDefault();
          onOpen(focused.id);
        }
        return;
      case 'Escape':
        if (selection.selected.size > 0) {
          event.preventDefault();
          selection.clear();
        }
        return;
      case 'Delete':
      case 'Backspace':
        if (selection.selected.size > 0) {
          event.preventDefault();
          onDeleteSelected();
        }
        return;
      default:
        return;
    }
  };

  const selecting = selection.selected.size > 0;
  const showEmpty = !loading && items.length === 0;

  return (
    <div
      className="relative flex h-[max(24rem,calc(100dvh-17rem))] flex-col overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]"
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
        data-testid="file-browser-scroll"
      >
        {loading ? (
          <FileBrowserSkeleton viewMode={viewMode} />
        ) : (
          <div className="relative w-full" style={{ height: Math.max(0, contentHeight) }}>
            {rows.map((row) =>
              Array.from({ length: layout.columns }, (_, column) => {
                const index = row.index * layout.columns + column;
                const item = items[index];
                if (!item) return null;
                const rect = itemRect(layout, index);
                const style = {
                  left: rect.left,
                  top: row.start,
                  width: rect.width,
                  height: rect.height,
                };
                const isSelected = selection.selected.has(item.id);
                return viewMode === 'grid' ? (
                  <FileGridItem
                    key={item.id}
                    item={item}
                    selected={isSelected}
                    focused={index === focusIndex}
                    selecting={selecting}
                    style={style}
                    onStaleUrl={onStaleUrl}
                    onToggle={onToggle}
                  />
                ) : (
                  <FileListRow
                    key={item.id}
                    item={item}
                    columns={layout.listColumns}
                    selected={isSelected}
                    focused={index === focusIndex}
                    style={style}
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
            {emptyContent}
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
          className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-[var(--color-brand)] bg-[color-mix(in_srgb,var(--color-surface)_85%,transparent)] text-[var(--color-brand)]"
          data-testid="file-drop-overlay"
        >
          <Icon name="upload" size={24} />
          <span className="text-sm font-medium">{t('file.upload.dropHint')}</span>
        </div>
      )}
    </div>
  );
}

function FileBrowserSkeleton({ viewMode }: { viewMode: FileViewMode }) {
  return viewMode === 'grid' ? (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-3 p-3" aria-hidden>
      {Array.from({ length: 12 }, (_, index) => (
        <Skeleton key={index} height="11rem" />
      ))}
    </div>
  ) : (
    <div className="flex flex-col gap-2 p-3" aria-hidden>
      {Array.from({ length: 10 }, (_, index) => (
        <Skeleton key={index} height="2.25rem" />
      ))}
    </div>
  );
}
