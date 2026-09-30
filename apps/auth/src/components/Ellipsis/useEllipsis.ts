import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Ref, RefCallback } from 'react';

/**
 * 什麼時候把內容整個換成替代節點（收合）。
 *
 * - 數字：**容器**（元件的父元素）的內容寬度小於這個 px 時收合。量的是父元素而不是自己，
 *   因為收合後自己會變窄，拿自己比會永遠展不回來。
 * - `'overflow'`：完整內容放不下（出現省略號）時收合；容器變寬到補得回當初不足的寬度時再展開。
 */
export type EllipsisCollapseAt = number | 'overflow';

/** `auto`：被截斷或已收合才顯示；`always`：一律顯示；`never`：不顯示。 */
export type EllipsisTooltip = 'auto' | 'always' | 'never';

export interface UseEllipsisOptions {
  /** 行數；大於 1 時用高度判斷是否截斷。 */
  lines: number;
  collapseAt?: EllipsisCollapseAt;
  onCollapseChange?: (collapsed: boolean) => void;
}

export interface EllipsisState {
  /** 當 ref 掛在實際套用省略號的元素上。 */
  attachText: RefCallback<HTMLElement>;
  /** 當 ref 掛在元件根元素上（容器 = 它的父元素）；沒掛時以 `attachText` 的元素為根。 */
  attachAnchor: RefCallback<HTMLElement>;
  isTruncated: boolean;
  isCollapsed: boolean;
}

interface CollapseBaseline {
  /** 收合當下的容器寬度。 */
  containerWidth: number;
  /** 收合當下還差多少寬度才放得下完整內容。 */
  deficit: number;
}

/** 元素扣掉左右 padding 的寬度。 */
export function contentWidth(element: HTMLElement): number {
  const style = getComputedStyle(element);
  return (
    element.clientWidth -
    (Number.parseFloat(style.paddingLeft) || 0) -
    (Number.parseFloat(style.paddingRight) || 0)
  );
}

/** 放下完整內容還缺多少寬度；0 代表沒有被截斷。多行時以高度比例換算成寬度（近似值）。 */
function overflowDeficit(element: HTMLElement, lines: number): number {
  if (lines > 1) {
    const { clientHeight, clientWidth, scrollHeight } = element;
    if (clientHeight === 0 || scrollHeight <= clientHeight) return 0;
    return clientWidth * (scrollHeight / clientHeight - 1);
  }
  return Math.max(0, element.scrollWidth - element.clientWidth);
}

/**
 * 量測省略號元件的兩個狀態：內容是否被截斷、是否該收合成替代節點。
 * 每次 render 後與元素或容器尺寸變動時（`ResizeObserver`）重新量測。
 */
export function useEllipsis({
  lines,
  collapseAt,
  onCollapseChange,
}: UseEllipsisOptions): EllipsisState {
  const [text, setText] = useState<HTMLElement | null>(null);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [isTruncated, setTruncated] = useState(false);
  const [isCollapsed, setCollapsed] = useState(false);
  const baselineRef = useRef<CollapseBaseline | null>(null);

  const measure = () => {
    if (!text) return;
    const container = (anchor ?? text).parentElement;
    const containerWidth = container ? contentWidth(container) : 0;

    let collapsed = false;
    if (typeof collapseAt === 'number') {
      // 尚未布局（display: none、測試環境）時寬度是 0，不能拿來判斷
      if (containerWidth === 0) return;
      collapsed = containerWidth < collapseAt;
    } else if (collapseAt === 'overflow') {
      const baseline = baselineRef.current;
      if (baseline) {
        collapsed = containerWidth - baseline.containerWidth < baseline.deficit;
        if (!collapsed) baselineRef.current = null;
      } else {
        const deficit = overflowDeficit(text, lines);
        collapsed = deficit > 0;
        if (collapsed) baselineRef.current = { containerWidth, deficit };
      }
    }
    if (collapseAt !== 'overflow') baselineRef.current = null;

    setCollapsed(collapsed);
    // 收合時元素裡放的是替代節點，量到的不是原內容
    setTruncated(!collapsed && overflowDeficit(text, lines) > 0);
  };

  const measureRef = useRef(measure);
  // setState 值不變時 React 會略過重新 render，所以每次 render 後都量一次不會無限循環
  useLayoutEffect(() => {
    measureRef.current = measure;
    measure();
  });

  useLayoutEffect(() => {
    if (!text || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => measureRef.current());
    observer.observe(text);
    const container = (anchor ?? text).parentElement;
    if (container) observer.observe(container);
    return () => observer.disconnect();
  }, [text, anchor]);

  const onCollapseChangeRef = useRef(onCollapseChange);
  useLayoutEffect(() => {
    onCollapseChangeRef.current = onCollapseChange;
  });
  const previousCollapsed = useRef(isCollapsed);
  useEffect(() => {
    if (previousCollapsed.current === isCollapsed) return;
    previousCollapsed.current = isCollapsed;
    onCollapseChangeRef.current?.(isCollapsed);
  }, [isCollapsed]);

  return { attachText: setText, attachAnchor: setAnchor, isTruncated, isCollapsed };
}

function assignRef<T>(ref: Ref<T> | undefined, node: T | null): void {
  if (typeof ref === 'function') ref(node);
  else if (ref) ref.current = node;
}

/** 把呼叫端的 ref 與量測用的 callback ref 合成一個。 */
export function useComposedRef<T>(ref: Ref<T> | undefined, attach: RefCallback<T>): RefCallback<T> {
  return useCallback(
    (node: T | null) => {
      attach(node);
      assignRef(ref, node);
    },
    [ref, attach],
  );
}

export function shouldShowTooltip(
  mode: EllipsisTooltip,
  { isTruncated, isCollapsed }: Pick<EllipsisState, 'isTruncated' | 'isCollapsed'>,
): boolean {
  if (mode === 'always') return true;
  if (mode === 'never') return false;
  return isTruncated || isCollapsed;
}
