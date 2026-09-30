import { useCallback, useState } from 'react';
import type { CSSProperties, ReactNode, Ref } from 'react';

import { cn } from '@/shared/utils';

import { createSlots } from '../slots';
import type { SlotOverrides } from '../slots';
import { Spinner } from '../Spinner';
import { useInfiniteScroll } from './useInfiniteScroll';
import { useVirtualRows, withRowPosition } from './useVirtualRows';

import styles from './VirtualList.module.css';

/** `className` / `style` / `data-testid` 落在捲動容器；其餘各層用 `classNames` / `styles` / `testIds` 覆寫。 */
export type VirtualListSlot = 'list' | 'item' | 'footer';

export interface VirtualListProps<T> extends SlotOverrides<VirtualListSlot> {
  /** 透傳到捲動容器（React 19 的 ref 是一般 prop）。 */
  ref?: Ref<HTMLDivElement>;
  items: readonly T[];
  getKey: (item: T, index: number) => string;
  renderItem: (item: T, index: number) => ReactNode;
  /** 預估列高（px）；列高固定時設成實際值，捲動最穩。 */
  estimateSize?: number;
  /** 筆數超過這個值才虛擬化。預設 100。 */
  virtualThreshold?: number;
  overscan?: number;
  /** 無限捲動：還有下一頁。 */
  hasMore?: boolean;
  /** 無限捲動：正在載入下一頁。 */
  loading?: boolean;
  /** 無限捲動：捲到接近底部時呼叫。 */
  onLoadMore?: () => void;
  loadingContent?: ReactNode;
  emptyContent?: ReactNode;
  className?: string;
  style?: CSSProperties;
  'aria-label'?: string;
  'data-testid'?: string;
}

interface RowProps {
  index: number;
  start: number | undefined;
  measureElement: ((element: Element | null) => void) | undefined;
  className: string | undefined;
  style: CSSProperties | undefined;
  testId: string | undefined;
  children: ReactNode;
}

function Row({ index, start, measureElement, className, style, testId, children }: RowProps) {
  return (
    <li
      ref={measureElement}
      data-index={index}
      className={className}
      style={withRowPosition(style, start)}
      data-testid={testId}
    >
      {children}
    </li>
  );
}

/**
 * 長列表：超過門檻自動虛擬捲動，並支援無限捲動。容器高度由呼叫端決定（`style` 或 `className`）。
 * 下拉型元件（`Select`、`Menu`）直接用同資料夾的 hooks，而不是這個元件。
 */
export function VirtualList<T>({
  ref,
  items,
  getKey,
  renderItem,
  estimateSize = 40,
  virtualThreshold,
  overscan,
  hasMore,
  loading,
  onLoadMore,
  loadingContent,
  emptyContent,
  className,
  classNames,
  styles: styleOverrides,
  testIds,
  ...rest
}: VirtualListProps<T>) {
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

  const { rows, containerStyle, measureElement } = useVirtualRows({
    count: items.length,
    scrollElement,
    estimateSize,
    threshold: virtualThreshold,
    overscan,
  });
  const { onScroll } = useInfiniteScroll({
    scrollElement,
    count: items.length,
    hasMore,
    loading,
    onLoadMore,
  });

  const itemSlot = slot('item', styles.item, { testId: 'virtual-list-item' });
  const listSlot = slot('list');

  return (
    <div ref={composedRef} className={cn(styles.root, className)} onScroll={onScroll} {...rest}>
      <ul
        className={cn(styles.list, listSlot.className)}
        style={containerStyle ? { ...listSlot.style, ...containerStyle } : listSlot.style}
        data-testid={listSlot['data-testid']}
      >
        {rows.map(({ index, start }) => {
          const item = items[index] as T;
          return (
            <Row
              key={getKey(item, index)}
              index={index}
              start={start}
              measureElement={measureElement}
              className={itemSlot.className}
              style={itemSlot.style}
              testId={itemSlot['data-testid']}
            >
              {renderItem(item, index)}
            </Row>
          );
        })}
      </ul>
      {(loading || (items.length === 0 && emptyContent)) && (
        <div {...slot('footer', styles.footer, { testId: 'virtual-list-footer' })}>
          {loading ? (loadingContent ?? <Spinner size={16} />) : emptyContent}
        </div>
      )}
    </div>
  );
}
