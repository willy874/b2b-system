import { Children, isValidElement, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { HTMLAttributes, ReactNode, Ref } from 'react';

import { cn } from '@/shared/utils';

import { createSlots } from '../slots';
import type { SlotOverrides } from '../slots';
import { Tooltip } from '../Tooltip';
import { contentWidth, useComposedRef } from './useEllipsis';

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

/** 容忍次像素誤差，避免剛好放得下時被判定為溢出。 */
const EPSILON = 0.5;

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
  const total =
    widths.reduce((sum, width) => sum + width, 0) + gap * Math.max(0, widths.length - 1);
  if (widths.length <= limit && total <= available + EPSILON) return widths.length;

  let used = overflowWidth;
  let count = 0;
  for (const width of widths.slice(0, Math.min(widths.length, limit))) {
    const next = used + width + gap;
    if (next > available + EPSILON) break;
    used = next;
    count += 1;
  }
  return count;
}

function itemKey(item: ReactNode, index: number): string {
  return isValidElement(item) && item.key !== null ? item.key : String(index);
}

/**
 * 橫向排列一組項目，放不下（或超過 `maxVisible`）的從尾端收進溢出區。
 *
 * 量測方式：項目增減或 `measureKey` 改變時，先把全部項目與「全部隱藏」時的溢出區渲染出來量寬度，
 * 在 layout effect 內同步算出可見數量（畫面不會閃）；之後容器縮放只用快取的寬度重算。
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

  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const composedRef = useComposedRef<HTMLDivElement>(ref, setRoot);
  const itemElements = useRef<Array<HTMLDivElement | null>>([]);
  const overflowElement = useRef<HTMLDivElement | null>(null);
  const widthsRef = useRef<number[]>([]);
  const overflowWidthRef = useRef(0);
  const lastWidthRef = useRef<number | null>(null);

  const [measuredSignature, setMeasuredSignature] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(items.length);
  const isMeasuring = fit && measuredSignature !== signature;

  const count = isMeasuring ? items.length : Math.min(visibleCount, items.length);
  const overflowInfo: BoxEllipsisOverflowInfo = isMeasuring
    ? // 以「全部隱藏」量溢出區，保守預留它最寬時的寬度
      { hiddenItems: items, hiddenCount: items.length, visibleCount: 0 }
    : { hiddenItems: items.slice(count), hiddenCount: items.length - count, visibleCount: count };

  const onWidthChangeRef = useRef(onWidthChange);
  /** 需要時先量項目寬度，再依容器寬度算出可見數量。 */
  const sync = () => {
    if (!root) return;
    if (isMeasuring) {
      widthsRef.current = items.map(
        (_, index) => itemElements.current[index]?.getBoundingClientRect().width ?? 0,
      );
      overflowWidthRef.current = overflowElement.current?.getBoundingClientRect().width ?? 0;
      setMeasuredSignature(signature);
    }

    const width = contentWidth(root);
    if (width !== lastWidthRef.current) {
      lastWidthRef.current = width;
      onWidthChangeRef.current?.(width);
    }
    const limit = resolveLimit(maxVisible, width);
    if (!fit || width <= 0) {
      setVisibleCount(Math.min(items.length, limit));
      return;
    }
    const gap = Number.parseFloat(getComputedStyle(root).columnGap) || 0;
    setVisibleCount(fitCount(widthsRef.current, overflowWidthRef.current, gap, width, limit));
  };

  const syncRef = useRef(sync);
  // 量測必須在畫面繪製前完成才不會閃；setState 值不變時 React 會略過重新 render，不會無限循環
  useLayoutEffect(() => {
    onWidthChangeRef.current = onWidthChange;
    syncRef.current = sync;
    syncRef.current();
  });

  useLayoutEffect(() => {
    if (!root || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => syncRef.current());
    observer.observe(root);
    return () => observer.disconnect();
  }, [root, syncRef]);

  // 網頁字型載入後文字寬度會變，重新量一次
  useEffect(() => {
    let isActive = true;
    void document.fonts?.ready.then(() => {
      if (isActive) setMeasuredSignature(null);
    });
    return () => {
      isActive = false;
    };
  }, []);

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
          ref={(element) => {
            itemElements.current[index] = element;
          }}
          {...slot('item', styles.boxItem)}
          data-value={index}
        >
          {item}
        </div>
      ))}
      {overflowInfo.hiddenCount > 0 && (
        <div ref={overflowElement} {...slot('overflow', styles.boxOverflow)}>
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
