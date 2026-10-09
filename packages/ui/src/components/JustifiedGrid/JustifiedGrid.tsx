import { cn } from '@b2b-system/web-shared/utils';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode, Ref, UIEvent } from 'react';

import { createSlots } from '../slots';
import type { SlotOverrides } from '../slots';
import { useElementSize } from '../useElementSize';
import { useLatestRef } from '../useLatestRef';
import { useInfiniteScroll } from '../VirtualList/useInfiniteScroll';
import { createGridLayoutCache, sectionIndexAt, visibleRange } from './layout';
import type {
  GridItemRect,
  GridLayout,
  GridLayoutMode,
  GridSectionInput,
  GridSectionRect,
} from './layout';

import styles from './JustifiedGrid.module.css';

/** 一個區段：`label` 是預設的區段標題內容。 */
export interface JustifiedGridSection extends GridSectionInput {
  label?: ReactNode;
}

/** `renderHeader` 收到的區段：位置加上 `label`。 */
export type JustifiedGridHeader = GridSectionRect & { label?: ReactNode };

/**
 * `className` / `style` / `data-testid` 落在根元素（捲動容器）；其餘各層用 `classNames` / `styles` / `testIds` 覆寫：
 * `scroller` 是撐出整個內容高度的那一層，`section` 是每個區段的定位容器，`header` 是黏在上方的區段標題，
 * `item` 是包住 `renderItem` 的絕對定位容器（`data-value` 是項目的 key）。
 */
export type JustifiedGridSlot = 'scroller' | 'section' | 'header' | 'item';

export interface JustifiedGridProps extends SlotOverrides<JustifiedGridSlot> {
  /** 透傳到根元素：它就是捲動容器，呼叫端可以設 `scrollTop`、做框選、算位置。 */
  ref?: Ref<HTMLDivElement>;
  sections: readonly JustifiedGridSection[];
  /** 預設 `justified`。 */
  mode?: GridLayoutMode;
  /** 目標列高（方格時是格子邊長的目標），預設 180。 */
  rowHeight?: number;
  /** 項目之間與區段之間的間距，預設 4。 */
  gap?: number;
  /** 區段標題的高度，預設 40；沒有任何 `label` 也沒有 `renderHeader` 時當成 0（不顯示標題）。 */
  headerHeight?: number;
  /** 最後一列放不滿時，列高最多拉到 `rowHeight × 這個值`；預設 1（不拉伸、靠左）。 */
  maxRowHeightRatio?: number;
  /** 項目的內容；元件會包一層絕對定位、尺寸等於 `item` 的容器。 */
  renderItem: (item: GridItemRect) => ReactNode;
  /** 區段標題的內容；預設顯示 `label`。 */
  renderHeader?: (section: JustifiedGridHeader) => ReactNode;
  /** 可視範圍上下額外渲染的距離（px）；預設一個可視高度。 */
  overscan?: number;
  /** 版面重算之後呼叫（框選、日期捲軸用）。 */
  onLayoutChange?: (layout: GridLayout) => void;
  /** 捲到距離底部 `endReachedThreshold` 以內時呼叫；內容不滿一屏時也會呼叫。同一個項目數只呼叫一次。 */
  onEndReached?: () => void;
  /** 預設 600 px。 */
  endReachedThreshold?: number;
  /** 最上方的區段改變時呼叫（例：外部的捲軸標出目前的位置）。 */
  onVisibleSectionChange?: (sectionKey: string) => void;
  className?: string;
  style?: CSSProperties;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
  'data-testid'?: string;
}

/**
 * 等高排列或正方形方格的分區段版面（docs/architecture/frontend/07-ui-system.md §3.19），只渲染可視範圍內的項目。
 * 寬高比由資料提供，不等圖片載入；版面以區段為單位增量計算（`createGridLayoutCache`）。
 * 根元素是捲動容器，高度由呼叫端決定（`style` 或 `className`）。
 */
export function JustifiedGrid({
  ref,
  sections,
  mode = 'justified',
  rowHeight = 180,
  gap = 4,
  headerHeight = 40,
  maxRowHeightRatio,
  renderItem,
  renderHeader,
  overscan,
  onLayoutChange,
  onEndReached,
  endReachedThreshold = 600,
  onVisibleSectionChange,
  className,
  classNames,
  styles: styleOverrides,
  testIds,
  ...rest
}: JustifiedGridProps) {
  const slot = createSlots({ classNames, styles: styleOverrides, testIds });
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null);
  const composedRef = useCallback(
    (element: HTMLDivElement | null) => {
      setScrollElement(element);
      if (typeof ref === 'function') ref(element);
      else if (ref) ref.current = element;
    },
    [ref],
  );
  const viewport = useElementSize(scrollElement);
  const [scrollTop, setScrollTop] = useState(0);

  const hasHeaders =
    Boolean(renderHeader) ||
    sections.some((section) => section.label !== undefined && section.label !== null);
  const effectiveHeaderHeight = hasHeaders ? headerHeight : 0;

  const [layoutCache] = useState(createGridLayoutCache);
  const layout = useMemo(
    () =>
      layoutCache.compute(sections, {
        containerWidth: viewport.width,
        rowHeight,
        gap,
        headerHeight: effectiveHeaderHeight,
        mode,
        maxRowHeightRatio,
      }),
    [
      layoutCache,
      sections,
      viewport.width,
      rowHeight,
      gap,
      effectiveHeaderHeight,
      mode,
      maxRowHeightRatio,
    ],
  );

  const onLayoutChangeRef = useLatestRef(onLayoutChange);
  useEffect(() => {
    onLayoutChangeRef.current?.(layout);
  }, [layout, onLayoutChangeRef]);

  // 最上方的區段：只在改變時通知
  const onVisibleSectionChangeRef = useLatestRef(onVisibleSectionChange);
  const lastVisibleSection = useRef<string | undefined>(undefined);
  const topSectionKey = layout.sections[sectionIndexAt(layout, scrollTop)]?.key;
  useEffect(() => {
    if (topSectionKey === undefined || topSectionKey === lastVisibleSection.current) return;
    lastVisibleSection.current = topSectionKey;
    onVisibleSectionChangeRef.current?.(topSectionKey);
  }, [topSectionKey, onVisibleSectionChangeRef]);

  const totalCount = useMemo(
    () => sections.reduce((sum, section) => sum + section.items.length, 0),
    [sections],
  );
  const { onScroll: checkEndReached } = useInfiniteScroll({
    scrollElement,
    count: totalCount,
    // 寬度還沒量到時版面是空的，不能拿「內容不滿一屏」當成要載入下一頁
    hasMore: Boolean(onEndReached) && (viewport.width > 0 || totalCount === 0),
    onLoadMore: onEndReached,
    threshold: endReachedThreshold,
  });

  const onScroll = (event: UIEvent<HTMLDivElement>) => {
    setScrollTop(event.currentTarget.scrollTop);
    checkEndReached();
  };

  const extra = overscan ?? viewport.height;
  const windowTop = scrollTop - extra;
  const windowBottom = scrollTop + viewport.height + extra;
  const range = visibleRange(layout, windowTop, windowBottom);

  const scrollerSlot = slot('scroller', styles.scroller);
  const sectionNodes: ReactNode[] = [];
  layout.sections.forEach((section, sectionIndex) => {
    if (section.top >= windowBottom || section.top + section.height <= windowTop) return;
    const start = Math.max(range.start, section.itemsStart);
    const end = Math.min(range.end, section.itemsStart + section.itemCount);
    const label = sections[sectionIndex]?.label;
    const items: ReactNode[] = [];
    for (let index = start; index < end; index += 1) {
      const item = layout.items[index];
      if (!item) continue;
      items.push(
        <div
          key={item.key}
          data-value={item.key}
          {...slot('item', styles.item, {
            testId: 'justified-grid-item',
            style: {
              left: item.left,
              top: item.top - section.top,
              width: item.width,
              height: item.height,
            },
          })}
        >
          {renderItem(item)}
        </div>,
      );
    }
    sectionNodes.push(
      <div
        key={section.key}
        data-value={section.key}
        {...slot('section', styles.section, {
          style: { top: section.top, height: section.height },
        })}
      >
        {section.headerHeight > 0 && (
          // 標題黏在捲動容器頂端，直到區段的底部把它推出去
          <div
            data-value={section.key}
            {...slot('header', styles.header, {
              testId: 'justified-grid-header',
              style: { height: section.headerHeight },
            })}
          >
            {renderHeader ? renderHeader({ ...section, label }) : label}
          </div>
        )}
        {items}
      </div>,
    );
  });

  return (
    <div {...rest} ref={composedRef} className={cn(styles.root, className)} onScroll={onScroll}>
      <div
        className={scrollerSlot.className}
        style={{ ...scrollerSlot.style, height: layout.height }}
        data-testid={scrollerSlot['data-testid']}
      >
        {sectionNodes}
      </div>
    </div>
  );
}
