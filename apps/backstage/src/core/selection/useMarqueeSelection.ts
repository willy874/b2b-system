import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';

import { edgeScrollDelta, rectFromPoints } from './geometry';
import type { Rect } from './geometry';

/** 拖曳超過這個距離才算框選（以下視為點擊空白處）。 */
const DRAG_THRESHOLD = 4;

/** 框選怎麼套用到原本的選取：疊加（開始時按著 Shift / Ctrl / ⌘）或取代。 */
export type MarqueeMode = 'replace' | 'add';

/** 項目預設的標記：從標了它的元素上開始的拖曳是點擊或拖曳項目，不是框選。 */
export const MARQUEE_ITEM_SELECTOR = '[data-marquee-item]';

export interface UseMarqueeSelectionOptions {
  /** 捲動容器：框選在它的內容座標上計算，拖到它的上下邊緣時自動捲動。 */
  scrollElement: HTMLElement | null;
  enabled: boolean;
  /**
   * 框（內容座標）命中的項目 id，依序。以版面幾何計算，而不是查 DOM：虛擬捲動沒渲染的項目也算得到。
   * 拖曳期間每次移動都會呼叫，要快（只算框涵蓋的範圍）。
   */
  hitTest: (rect: Rect) => readonly string[];
  /** 開始框選時的選取：疊加模式以它為底。 */
  getSelected: () => ReadonlySet<string>;
  /** 拖曳中每次更新：`ids` 是目前命中的，`base` 是開始時的選取。 */
  apply: (ids: readonly string[], mode: MarqueeMode, base: ReadonlySet<string>) => void;
  /** 在空白處單純點一下（沒拖曳、沒按疊加鍵）時清空選取。 */
  clear: () => void;
  /** 項目的 CSS 選擇器（預設 `MARQUEE_ITEM_SELECTOR`）；按鈕、連結、輸入框、label 上開始的一律不算。 */
  itemSelector?: string;
}

export interface MarqueeSelection {
  /** 拖曳中的框（內容座標）；沒有在框選時是 `undefined`。 */
  marquee: Rect | undefined;
  /** 掛在捲動容器（或它的內容）的 `onPointerDown`。 */
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
}

/**
 * 在空白處按下滑鼠拖曳出矩形來多選（docs/architecture/frontend/12-file-manager.md §7）。不認識項目的版面：
 * 命中由呼叫端的 `hitTest` 計算，選取由 `apply`／`clear` 套用。
 *
 * - 按著 Shift / Ctrl / ⌘ 開始時疊加在原本的選取上，否則取代。
 * - 拖到上下邊緣自動捲動（`edgeScrollDelta`），框的起點固定在內容座標上。
 * - 只接受滑鼠與觸控筆的左鍵：觸控的拖曳是捲動，不搶。
 * - 從項目或控制項上開始的、在捲軸上按下的都不算。
 * - 在空白處單純點一下（沒拖曳）清空選取。
 */
export function useMarqueeSelection({
  scrollElement,
  enabled,
  hitTest,
  getSelected,
  apply,
  clear,
  itemSelector = MARQUEE_ITEM_SELECTOR,
}: UseMarqueeSelectionOptions): MarqueeSelection {
  const [marquee, setMarquee] = useState<Rect>();
  // 拖曳期間資料可能更新（推播、無限捲動載入下一頁）：一律讀最新的值
  const latest = useRef({ hitTest, getSelected, apply, clear });
  useLayoutEffect(() => {
    latest.current = { hitTest, getSelected, apply, clear };
  });
  const cleanup = useRef<() => void>(undefined);
  useEffect(() => () => cleanup.current?.(), []);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (!enabled || !scrollElement || event.button !== 0 || event.pointerType === 'touch') return;
      const target = event.target as Element;
      // 從項目或控制項上開始的是點擊，不是框選
      if (target.closest(`${itemSelector}, button, a, input, label`)) return;
      // 捲軸上按下（點在 clientWidth 之外）是拖捲軸
      const bounds = scrollElement.getBoundingClientRect();
      if (event.clientX - bounds.left > scrollElement.clientWidth) return;

      const toContent = (clientX: number, clientY: number) => {
        const box = scrollElement.getBoundingClientRect();
        return {
          x: clientX - box.left + scrollElement.scrollLeft,
          y: clientY - box.top + scrollElement.scrollTop,
        };
      };
      const start = toContent(event.clientX, event.clientY);
      const additive = event.shiftKey || event.ctrlKey || event.metaKey;
      const mode: MarqueeMode = additive ? 'add' : 'replace';
      const base = latest.current.getSelected();
      let pointer = { x: event.clientX, y: event.clientY };
      let dragging = false;
      let frame = 0;

      const update = () => {
        const current = toContent(pointer.x, pointer.y);
        if (!dragging && Math.hypot(current.x - start.x, current.y - start.y) < DRAG_THRESHOLD) {
          return;
        }
        dragging = true;
        const rect = rectFromPoints(start, current);
        setMarquee(rect);
        latest.current.apply(latest.current.hitTest(rect), mode, base);
      };

      const autoScroll = () => {
        frame = requestAnimationFrame(autoScroll);
        if (!dragging) return;
        const delta = edgeScrollDelta(pointer.y, scrollElement.getBoundingClientRect());
        if (delta !== 0) {
          scrollElement.scrollTop += delta;
          update();
        }
      };

      const onMove = (moveEvent: PointerEvent) => {
        pointer = { x: moveEvent.clientX, y: moveEvent.clientY };
        update();
      };
      const finish = () => {
        cleanup.current?.();
        if (!dragging && !additive) latest.current.clear();
      };

      scrollElement.setPointerCapture?.(event.pointerId);
      scrollElement.addEventListener('pointermove', onMove);
      scrollElement.addEventListener('pointerup', finish);
      scrollElement.addEventListener('pointercancel', finish);
      frame = requestAnimationFrame(autoScroll);
      cleanup.current = () => {
        cancelAnimationFrame(frame);
        scrollElement.removeEventListener('pointermove', onMove);
        scrollElement.removeEventListener('pointerup', finish);
        scrollElement.removeEventListener('pointercancel', finish);
        if (scrollElement.hasPointerCapture?.(event.pointerId)) {
          scrollElement.releasePointerCapture(event.pointerId);
        }
        cleanup.current = undefined;
        setMarquee(undefined);
      };
      // 防止拖曳時選到文字
      event.preventDefault();
      scrollElement.focus({ preventScroll: true });
    },
    [enabled, scrollElement, itemSelector],
  );

  return { marquee, onPointerDown };
}
