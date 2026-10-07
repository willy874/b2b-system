import { useVirtualizer } from '@tanstack/react-virtual';
import { useCallback, useLayoutEffect } from 'react';

import { itemRect } from './layout';
import type { FileLayout } from './layout';

/** 列數在這以下不虛擬化：全部渲染（測試環境沒有版面，也靠它看得到項目）。 */
const VIRTUAL_THRESHOLD_ROWS = 40;

export interface BrowserRow {
  index: number;
  /** 這一列的頂端（px，相對於內容） */
  start: number;
}

/**
 * 檔案瀏覽區的列（docs/architecture/frontend/12-file-manager.md §3）：列數多時以 TanStack Virtual 只算看得到的列，
 * 少時全部列出；`scrollToIndex` 把某個項目捲進可視範圍（鍵盤移動焦點時用）。
 */
export function useBrowserRows(
  scrollElement: HTMLElement | null,
  layout: FileLayout,
  /** 一律虛擬化（例：有佔位時：全部渲染會讓佔位一直「看得到」而不停往回抓）。 */
  forceVirtual = false,
) {
  const virtualize = forceVirtual || layout.rowCount > VIRTUAL_THRESHOLD_ROWS;
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

  const rows: BrowserRow[] = virtualize
    ? virtualizer.getVirtualItems().map((row) => ({ index: row.index, start: row.start }))
    : Array.from({ length: layout.rowCount }, (_, index) => ({
        index,
        start: layout.padding + index * layout.rowStride,
      }));
  const contentHeight = virtualize
    ? virtualizer.getTotalSize()
    : layout.padding * 2 + layout.rowCount * layout.rowStride - layout.gap;

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

  return { rows, contentHeight, scrollToIndex };
}
