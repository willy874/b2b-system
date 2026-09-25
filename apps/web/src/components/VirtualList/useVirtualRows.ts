import { useVirtualizer } from '@tanstack/react-virtual';
import { useCallback, useMemo } from 'react';
import type { CSSProperties } from 'react';

/** 列數超過這個值才啟用虛擬捲動；少量資料直接渲染比較省（沒有定位與量測成本）。 */
export const DEFAULT_VIRTUAL_THRESHOLD = 100;

export interface UseVirtualRowsOptions {
  count: number;
  /** 捲動容器；彈出層關閉時為 `null`。用 state 保存（callback ref），掛上時才會重新計算。 */
  scrollElement: HTMLElement | null;
  /**
   * 預估列高（px）。列高固定時請讓它等於實際列高：量測結果與預估相同，
   * 就不會在捲動中修正位置（畫面不抖）。
   */
  estimateSize: number;
  /** `count` 超過這個值才虛擬化；傳 `0` 一律虛擬化、`Infinity` 一律不虛擬化。 */
  threshold?: number;
  /** 可視範圍外多渲染幾列，快速捲動時比較不會看到空白。 */
  overscan?: number;
}

export interface VirtualRow {
  index: number;
  /** 虛擬捲動時的列頂位置（px）；未虛擬化時為 `undefined`。 */
  start: number | undefined;
}

export interface VirtualRows {
  isVirtual: boolean;
  rows: VirtualRow[];
  /** 攤在包住所有列的容器上：虛擬捲動時撐出總高度，讓捲軸長度正確。 */
  containerStyle: CSSProperties | undefined;
  /** 虛擬捲動時掛在列元素上量實際高度（列元素要帶 `data-index`）。 */
  measureElement: ((element: Element | null) => void) | undefined;
  /**
   * 把某一列捲進可視範圍。`auto`（預設）已在範圍內就不動、否則捲最短距離；
   * `center` 一律置中（跳到搜尋結果這類「跳轉」用，前後文都看得到）。
   */
  scrollToIndex: (index: number, align?: 'auto' | 'center') => void;
}

/**
 * 把虛擬列的定位疊到列的樣式上（未虛擬化時原樣回傳）。
 * 列元件自己組，避免父層每次 render 都產生新物件而讓 `memo` 失效。
 */
export function withRowPosition(
  style: CSSProperties | undefined,
  start: number | undefined,
): CSSProperties | undefined {
  if (start === undefined) return style;
  return {
    ...style,
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    transform: `translateY(${start}px)`,
  };
}

/**
 * 列表的虛擬捲動（@tanstack/react-virtual）。未達門檻時回傳全部列，呼叫端用同一套渲染程式。
 * 捲動只在 `scrollToIndex` 被呼叫時發生——滑鼠移過列、勾選項目都不會觸發捲動。
 */
export function useVirtualRows({
  count,
  scrollElement,
  estimateSize,
  threshold = DEFAULT_VIRTUAL_THRESHOLD,
  overscan = 8,
}: UseVirtualRowsOptions): VirtualRows {
  const isVirtual = count > threshold;
  // oxlint-disable-next-line react/incompatible-library -- 本專案沒有啟用 React Compiler；虛擬列每次 render 都由 getVirtualItems() 重算，不會拿到過期的值
  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => scrollElement,
    estimateSize: useCallback(() => estimateSize, [estimateSize]),
    overscan,
    enabled: isVirtual,
    // 列數跨過門檻、從一般列表切換成虛擬捲動時（例如無限捲動載入第 N 頁），
    // virtualizer 會把捲動位置同步成 initialOffset；從容器當下的位置起算，才不會被彈回頂端
    initialOffset: () => scrollElement?.scrollTop ?? 0,
  });

  const scrollToIndex = useCallback(
    (index: number, align: 'auto' | 'center' = 'auto') => {
      if (index < 0 || index >= count) return;
      if (isVirtual) {
        virtualizer.scrollToIndex(index, { align });
        return;
      }
      scrollElement
        ?.querySelector<HTMLElement>(`[data-index="${index}"]`)
        // jsdom 沒有 scrollIntoView
        ?.scrollIntoView?.({ block: align === 'center' ? 'center' : 'nearest' });
    },
    [count, isVirtual, scrollElement, virtualizer],
  );

  const virtualItems = isVirtual ? virtualizer.getVirtualItems() : null;
  const totalSize = isVirtual ? virtualizer.getTotalSize() : 0;
  const rows = useMemo<VirtualRow[]>(
    () =>
      virtualItems
        ? virtualItems.map((item) => ({ index: item.index, start: item.start }))
        : Array.from({ length: count }, (_, index) => ({ index, start: undefined })),
    [virtualItems, count],
  );

  return {
    isVirtual,
    rows,
    containerStyle: isVirtual ? { position: 'relative', height: totalSize } : undefined,
    measureElement: isVirtual ? virtualizer.measureElement : undefined,
    scrollToIndex,
  };
}
