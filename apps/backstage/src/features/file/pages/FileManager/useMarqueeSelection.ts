import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';

import { hitTest, rectFromPoints } from './layout';
import type { FileLayout, Rect } from './layout';
import type { FileSelection, SelectionMode } from './useFileSelection';

/** 拖曳超過這個距離才算框選（以下視為點擊空白處）。 */
const DRAG_THRESHOLD = 4;
/** 指標靠近上下邊緣多少 px 時自動捲動。 */
const EDGE = 48;
/** 自動捲動每幀最多幾 px（越靠近邊緣越快）。 */
const MAX_SCROLL_SPEED = 24;

interface UseMarqueeSelectionOptions {
  scrollElement: HTMLElement | null;
  layout: FileLayout;
  ids: readonly string[];
  selection: FileSelection;
  enabled: boolean;
}

/**
 * 主區塊的框選（docs/architecture/frontend/12-file-manager.md §7）：在空白處按下滑鼠拖曳出矩形，
 * 以版面計算（`hitTest`）找出命中的項目——畫面外（虛擬捲動沒渲染）的項目也算得到。
 *
 * - 按著 Shift / Ctrl / ⌘ 開始時疊加在原本的選取上，否則取代。
 * - 拖到上下邊緣自動捲動，框的起點固定在內容座標上。
 * - 只接受滑鼠與觸控筆：觸控的拖曳是捲動，不搶。
 * - 在空白處單純點一下（沒拖曳）清空選取。
 */
export function useMarqueeSelection({
  scrollElement,
  layout,
  ids,
  selection,
  enabled,
}: UseMarqueeSelectionOptions) {
  const [marquee, setMarquee] = useState<Rect>();
  // 拖曳期間資料可能更新（推播、無限捲動載入下一頁）：一律讀最新的值
  const latest = useRef({ layout, ids, apply: selection.apply });
  useLayoutEffect(() => {
    latest.current = { layout, ids, apply: selection.apply };
  });
  const cleanup = useRef<() => void>(undefined);
  useEffect(() => () => cleanup.current?.(), []);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (!enabled || !scrollElement || event.button !== 0 || event.pointerType === 'touch') return;
      const target = event.target as Element;
      // 從項目或控制項上開始的是點擊，不是框選
      if (target.closest('[data-file-item], button, a, input, label')) return;
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
      const mode: SelectionMode = additive ? 'add' : 'replace';
      const base = selection.selected;
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
        const { layout: currentLayout, ids: currentIds, apply } = latest.current;
        const hits = hitTest(currentLayout, rect, currentIds.length);
        apply(
          hits.flatMap((index) => currentIds[index] ?? []),
          mode,
          base,
        );
      };

      const autoScroll = () => {
        frame = requestAnimationFrame(autoScroll);
        if (!dragging) return;
        const box = scrollElement.getBoundingClientRect();
        const distanceTop = pointer.y - box.top;
        const distanceBottom = box.bottom - pointer.y;
        let delta = 0;
        if (distanceTop < EDGE) delta = -MAX_SCROLL_SPEED * (1 - Math.max(0, distanceTop) / EDGE);
        else if (distanceBottom < EDGE) {
          delta = MAX_SCROLL_SPEED * (1 - Math.max(0, distanceBottom) / EDGE);
        }
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
        if (!dragging && !additive) selection.clear();
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
    [enabled, scrollElement, selection],
  );

  return { marquee, onPointerDown };
}
