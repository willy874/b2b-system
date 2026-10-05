import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { RefCallback } from 'react';
import { flushSync } from 'react-dom';

import { contentWidth } from './useEllipsis';

/** 容忍次像素誤差，避免剛好放得下時被判定為溢出。 */
const EPSILON = 0.5;

export interface FitLayout {
  /** 每個項目的寬度（依原順序）；不量測（`enabled: false`）時是空陣列。 */
  widths: number[];
  /** 溢出區在「全部隱藏」時的寬度。 */
  overflowWidth: number;
  /** 容器的 `column-gap`。 */
  gap: number;
  /** 容器的內容寬度；尚未布局（`display: none`、測試環境）時是 0。 */
  available: number;
}

export interface FitIndicesOptions {
  /** 最多顯示幾個項目。 */
  limit?: number;
  /** 一定要顯示的項目（例如選取中的分頁）；放不下時佔用最後一個可見位置。 */
  pinned?: number;
}

const range = (count: number): number[] => Array.from({ length: count }, (_, index) => index);

/**
 * 在 `available` 寬度內從頭依序放項目，回傳可見項目的索引（升冪）。
 * 有項目放不下時要預留溢出區的寬度；`pinned` 先預留它自己的寬度，其餘從頭放到第一個放不下的為止。
 */
export function fitIndices(
  widths: number[],
  overflowWidth: number,
  gap: number,
  available: number,
  { limit = Number.POSITIVE_INFINITY, pinned }: FitIndicesOptions = {},
): number[] {
  // 寬度 0 的項目（`display: none`）不佔位置，也不多出間距
  const occupied = widths.filter((width) => width > 0);
  const total =
    occupied.reduce((sum, width) => sum + width, 0) + gap * Math.max(0, occupied.length - 1);
  if (widths.length <= limit && total <= available + EPSILON) return range(widths.length);

  const pin = pinned !== undefined && pinned >= 0 && pinned < widths.length ? pinned : undefined;
  const max = Math.min(widths.length, limit) - (pin === undefined ? 0 : 1);
  let used = overflowWidth + (pin === undefined ? 0 : (widths[pin] ?? 0) + gap);
  const visible: number[] = [];
  for (const [index, width] of widths.entries()) {
    if (index === pin) continue;
    if (visible.length >= max) break;
    const next = width > 0 ? used + width + gap : used;
    if (next > available + EPSILON) break;
    used = next;
    visible.push(index);
  }
  if (pin !== undefined) visible.push(pin);
  return visible.toSorted((a, b) => a - b);
}

export interface UseFitItemsOptions {
  /** 項目的識別（順序、會改變寬度的狀態）；改變時重新量測。 */
  signature: string;
  count: number;
  /** `false` 時不量測，`pick` 拿到的 `widths` 是空陣列。 */
  enabled: boolean;
  /** 依量測結果決定可見的項目（索引，升冪）；每次 render 與容器縮放時呼叫，可依當下的 props 決定。 */
  pick: (layout: FitLayout) => number[];
  /** 容器內容寬度改變時呼叫。 */
  onWidthChange?: (width: number) => void;
}

export interface FitItemsState {
  /** 掛在容器上。 */
  attachRoot: RefCallback<HTMLElement>;
  /** 掛在第 `index` 個項目的最外層元素上。 */
  attachItem: (index: number) => RefCallback<HTMLElement>;
  /** 掛在溢出區上。 */
  attachOverflow: RefCallback<HTMLElement>;
  /** 量測中：要渲染全部項目，溢出區以「全部隱藏」的樣子渲染（保守預留它最寬時的寬度）。 */
  isMeasuring: boolean;
  /** 可見項目的索引（升冪）；量測中是全部。 */
  visible: number[];
}

const isSameIndices = (a: number[], b: number[]) =>
  a.length === b.length && a.every((value, index) => value === b[index]);

/**
 * 一排項目放不下時決定哪些可見：`signature` 改變時先渲染全部項目與溢出區量寬度，
 * 在 layout effect 內同步算出可見項目（畫面不會閃）；之後容器縮放只用快取的寬度重算。
 * `BoxEllipsis`、`Tabs`、`Toolbar` 共用（docs/architecture/frontend/07-ui-system.md §3.8）。
 */
export function useFitItems({
  signature,
  count,
  enabled,
  pick,
  onWidthChange,
}: UseFitItemsOptions): FitItemsState {
  const [root, setRoot] = useState<HTMLElement | null>(null);
  const itemElements = useRef<Array<HTMLElement | null>>([]);
  const overflowElement = useRef<HTMLElement | null>(null);
  const widthsRef = useRef<number[]>([]);
  const overflowWidthRef = useRef(0);
  const lastWidthRef = useRef<number | null>(null);

  const [measuredSignature, setMeasuredSignature] = useState<string | null>(null);
  const [visible, setVisible] = useState(() => range(count));
  const isMeasuring = enabled && measuredSignature !== signature;

  const onWidthChangeRef = useRef(onWidthChange);
  const sync = () => {
    if (!root) return;
    if (isMeasuring) {
      widthsRef.current = range(count).map(
        (index) => itemElements.current[index]?.getBoundingClientRect().width ?? 0,
      );
      overflowWidthRef.current = overflowElement.current?.getBoundingClientRect().width ?? 0;
      setMeasuredSignature(signature);
    }

    const width = contentWidth(root);
    if (width !== lastWidthRef.current) {
      lastWidthRef.current = width;
      onWidthChangeRef.current?.(width);
    }
    const next = pick({
      widths: enabled ? widthsRef.current : [],
      overflowWidth: overflowWidthRef.current,
      gap: Number.parseFloat(getComputedStyle(root).columnGap) || 0,
      available: width,
    });
    // 值相同時沿用舊陣列，React 才會略過重新 render
    setVisible((previous) => (isSameIndices(previous, next) ? previous : next));
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
    // ResizeObserver 在繪製前回呼；一般的 setState 會晚一幀才生效，縮放時先閃出溢出的版面
    const observer = new ResizeObserver(() => flushSync(() => syncRef.current()));
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

  return {
    attachRoot: setRoot,
    attachItem: (index) => (element) => {
      itemElements.current[index] = element;
    },
    attachOverflow: (element) => {
      overflowElement.current = element;
    },
    isMeasuring,
    visible: isMeasuring ? range(count) : visible.filter((index) => index < count),
  };
}
