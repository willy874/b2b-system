import { useCallback } from 'react';

import { useMarqueeSelection as useSharedMarqueeSelection } from '@/core/selection';
import type { MarqueeSelection, Rect } from '@/core/selection';

import { hitTest } from './layout';
import type { FileLayout } from './layout';
import type { FileSelection } from './useFileSelection';

interface UseMarqueeSelectionOptions {
  scrollElement: HTMLElement | null;
  layout: FileLayout;
  /** 每一格的 id；佔位的格是 `undefined`（框到也不選）。 */
  ids: readonly (string | undefined)[];
  selection: FileSelection;
  enabled: boolean;
}

/**
 * 主區塊的框選（docs/architecture/frontend/12-file-manager.md §7）：`core/selection` 的共用 hook，
 * 命中以檔案的版面計算（`hitTest`）——畫面外（虛擬捲動沒渲染）的項目也算得到。
 */
export function useMarqueeSelection({
  scrollElement,
  layout,
  ids,
  selection,
  enabled,
}: UseMarqueeSelectionOptions): MarqueeSelection {
  const hitTestRect = useCallback(
    (rect: Rect) => hitTest(layout, rect, ids.length).flatMap((index) => ids[index] ?? []),
    [layout, ids],
  );
  return useSharedMarqueeSelection({
    scrollElement,
    enabled,
    hitTest: hitTestRect,
    getSelected: () => selection.selected,
    apply: selection.apply,
    clear: selection.clear,
    itemSelector: '[data-file-item]',
  });
}
