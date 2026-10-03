import { Children, isValidElement, useEffect, useLayoutEffect, useRef } from 'react';
import type { HTMLAttributes, ReactNode, Ref } from 'react';

import { cn } from '@/shared/utils';

import { createSlots } from '../slots';
import type { SlotOverrides } from '../slots';
import { Tooltip } from '../Tooltip';
import { useComposedRef } from './useEllipsis';
import { fitIndices, useFitItems } from './useFitItems';

import styles from './Ellipsis.module.css';

/**
 * 最多顯示幾個項目（隱藏判斷點）。
 * 給函式時以容器內容寬度（px）決定，例如 `(width) => (width < 480 ? 1 : Infinity)`。
 */
export type BoxEllipsisMaxVisible = number | ((containerWidth: number) => number);

export interface BoxEllipsisOverflowInfo {
  /** 被收進溢出區的項目（依原順序）。 */
  hiddenItems: ReactNode[];
  hiddenCount: number;
  visibleCount: number;
}

/** `className` / `data-testid` 落在容器；每個項目外層與溢出區用 `classNames` / `styles` / `testIds` 覆寫。 */
export type BoxEllipsisSlot = 'item' | 'overflow';

export interface BoxEllipsisProps
  extends Omit<HTMLAttributes<HTMLDivElement>, 'children'>, SlotOverrides<BoxEllipsisSlot> {
  /** 透傳到容器（React 19 的 ref 是一般 prop）。 */
  ref?: Ref<HTMLDivElement>;
  /** 每個頂層子節點是一個項目（Fragment 不會被展開）。 */
  children: ReactNode;
  /** 最多顯示幾個項目；未設定時只受寬度限制。 */
  maxVisible?: BoxEllipsisMaxVisible;
  /** 依容器寬度自動把放不下的項目收進溢出區。預設 `true`；`false` 時只看 `maxVisible`。 */
  fit?: boolean;
  /** 溢出區（隱藏替代節點）；預設是 `+N`，hover 列出被隱藏的項目。 */
  renderOverflow?: (info: BoxEllipsisOverflowInfo) => ReactNode;
  /** 預設溢出區是否以提示框列出被隱藏的項目。預設 `true`。 */
  overflowTooltip?: boolean;
  /**
   * 項目寬度會變、但 key 沒變時（例如切換成只剩圖示），改變這個值讓元件重新量測。
   * 項目的增減與重新排序以 key 判斷，不需要這個值。
   */
  measureKey?: string | number | boolean;
  onOverflowChange?: (hiddenCount: number) => void;
  /** 容器內容寬度改變時呼叫（例如依寬度切換項目的外觀）。 */
  onWidthChange?: (containerWidth: number) => void;
}

function resolveLimit(maxVisible: BoxEllipsisMaxVisible | undefined, width: number): number {
  if (maxVisible === undefined) return Number.POSITIVE_INFINITY;
  if (typeof maxVisible === 'number') return Math.max(0, maxVisible);
  // 尚未布局時寬度是 0，不能拿來判斷
  return width > 0 ? Math.max(0, maxVisible(width)) : Number.POSITIVE_INFINITY;
}

/** 在 `available` 寬度內，從頭算起最多能放幾個項目；有項目放不下時要預留溢出區的寬度。 */
export function fitCount(
  widths: number[],
  overflowWidth: number,
  gap: number,
  available: number,
  limit: number,
): number {
  return fitIndices(widths, overflowWidth, gap, available, { limit }).length;
}

function itemKey(item: ReactNode, index: number): string {
  return isValidElement(item) && item.key !== null ? item.key : String(index);
}

/**
 * 橫向排列一組項目，放不下（或超過 `maxVisible`）的從尾端收進溢出區。
 *
 * 量測方式見 `useFitItems`：項目增減或 `measureKey` 改變時重新量寬度，之後容器縮放只用快取的寬度重算。
 * 容器寬度由父層決定（block 元素、或在 flex 裡給 `min-width: 0` 與 `flex: 1`）。
 */
export function BoxEllipsis({
  ref,
  children,
  maxVisible,
  fit = true,
  renderOverflow,
  overflowTooltip = true,
  measureKey,
  onOverflowChange,
  onWidthChange,
  className,
  classNames,
  styles: styleOverrides,
  testIds,
  ...rest
}: BoxEllipsisProps) {
  const items = Children.toArray(children);
  const signature = `${items.map(itemKey).join('|')}#${String(measureKey)}`;

  const { attachRoot, attachItem, attachOverflow, isMeasuring, visible } = useFitItems({
    signature,
    count: items.length,
    enabled: fit,
    onWidthChange,
    pick: ({ widths, overflowWidth, gap, available }) => {
      const limit = resolveLimit(maxVisible, available);
      const count =
        !fit || available <= 0
          ? Math.min(items.length, limit)
          : fitCount(widths, overflowWidth, gap, available, limit);
      return Array.from({ length: count }, (_, index) => index);
    },
  });
  const composedRef = useComposedRef<HTMLDivElement>(ref, attachRoot);

  const count = visible.length;
  const overflowInfo: BoxEllipsisOverflowInfo = isMeasuring
    ? // 以「全部隱藏」量溢出區，保守預留它最寬時的寬度
      { hiddenItems: items, hiddenCount: items.length, visibleCount: 0 }
    : { hiddenItems: items.slice(count), hiddenCount: items.length - count, visibleCount: count };

  const hiddenCount = isMeasuring ? null : overflowInfo.hiddenCount;
  const onOverflowChangeRef = useRef(onOverflowChange);
  useLayoutEffect(() => {
    onOverflowChangeRef.current = onOverflowChange;
  });
  const previousHidden = useRef(0);
  useEffect(() => {
    if (hiddenCount === null || previousHidden.current === hiddenCount) return;
    previousHidden.current = hiddenCount;
    onOverflowChangeRef.current?.(hiddenCount);
  }, [hiddenCount, previousHidden]);

  const slot = createSlots({ classNames, styles: styleOverrides, testIds });

  return (
    <div
      ref={composedRef}
      className={cn(styles.box, className)}
      data-overflowing={overflowInfo.hiddenCount > 0 || undefined}
      {...rest}
    >
      {items.slice(0, count).map((item, index) => (
        <div
          key={itemKey(item, index)}
          ref={attachItem(index)}
          {...slot('item', styles.boxItem)}
          data-value={index}
        >
          {item}
        </div>
      ))}
      {overflowInfo.hiddenCount > 0 && (
        <div ref={attachOverflow} {...slot('overflow', styles.boxOverflow)}>
          {renderOverflow ? (
            renderOverflow(overflowInfo)
          ) : (
            <Tooltip
              content={<div className={styles.overflowList}>{overflowInfo.hiddenItems}</div>}
              disabled={!overflowTooltip}
            >
              {/* 用 button 才能被鍵盤聚焦，看到提示框裡被隱藏的項目 */}
              <button type="button" className={styles.more}>
                +{overflowInfo.hiddenCount}
              </button>
            </Tooltip>
          )}
        </div>
      )}
    </div>
  );
}
