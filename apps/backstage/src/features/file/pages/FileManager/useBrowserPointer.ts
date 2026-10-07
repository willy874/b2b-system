import { useTranslation } from '@b2b-system/web-core/locales';
import { useCallback, useLayoutEffect, useRef } from 'react';
import type { DragEvent, MouseEvent, PointerEvent } from 'react';

import type { BrowserItemVM } from './adapter';
import type { FileSelection } from './useFileSelection';
import { draggedItemsOf } from './useItemDrag';
import type { ItemDrag } from './useItemDrag';

export interface UseBrowserPointerOptions {
  items: readonly BrowserItemVM[];
  selection: FileSelection;
  /** 點到的項目成為鍵盤焦點 */
  setFocusIndex: (index: number) => void;
  onOpen: (item: BrowserItemVM) => void;
  /** 框選（`useMarqueeSelection`）：pointerdown 交給它 */
  onMarqueeDown: (event: PointerEvent<HTMLDivElement>) => void;
  /** 所在的資料夾（拖曳項目的來源）；根目錄是 undefined。 */
  currentFolderId: string | undefined;
  itemDrag: ItemDrag;
  canMove: boolean;
}

/**
 * 檔案瀏覽區的滑鼠、觸控與拖曳（docs/architecture/frontend/12-file-manager.md §7、§12）。
 * 項目的事件以委派處理：容器上一個 handler，以 `data-file-item` 找出點到的項目，不在每一格掛 handler。
 * - 點擊選取（Shift 延伸、Ctrl／⌘ 切換）；觸控在還沒有選取時點一下就開啟
 * - 雙擊開啟；勾選框由項目自己的 `onToggle` 切換
 * - 拖曳已選取的項目整批移動、拖沒選取的只拖它；其中有不能移動的就整批不拖
 */
export function useBrowserPointer({
  items,
  selection,
  setFocusIndex,
  onOpen,
  onMarqueeDown,
  currentFolderId,
  itemDrag,
  canMove,
}: UseBrowserPointerOptions) {
  const { t } = useTranslation();
  const lastPointerType = useRef<string>('mouse');
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    lastPointerType.current = event.pointerType;
    onMarqueeDown(event);
  };

  const itemFromEvent = (event: MouseEvent) => {
    const element = (event.target as Element).closest<HTMLElement>('[data-file-item]');
    const id = element?.dataset.id;
    return id ? { id, index: items.findIndex((item) => item.id === id) } : undefined;
  };

  // 勾選框由它自己的 onCheckedChange 切換；以 ref 保持參考穩定，選取改變時項目不必全部重新渲染
  const toggleRef = useRef(selection.click);
  useLayoutEffect(() => {
    toggleRef.current = selection.click;
  });
  const onToggle = useCallback((id: string) => toggleRef.current(id, { toggle: true }), []);

  const openAt = (index: number) => {
    const item = items[index];
    if (item) onOpen(item);
  };

  const onClick = (event: MouseEvent<HTMLDivElement>) => {
    const hit = itemFromEvent(event);
    if (!hit) return;
    setFocusIndex(hit.index);
    // 勾選框（含 Base UI 轉發給隱藏 input 的第二次 click）已由 onToggle 處理
    if ((event.target as Element).closest('[data-file-checkbox]')) return;
    // 觸控：還沒有選取時點一下就打開（沒有雙擊）；進入選取後點一下是切換
    if (lastPointerType.current === 'touch') {
      if (selection.selected.size === 0) openAt(hit.index);
      else selection.click(hit.id, { toggle: true });
      return;
    }
    selection.click(hit.id, { shift: event.shiftKey, toggle: event.metaKey || event.ctrlKey });
  };

  const onDoubleClick = (event: MouseEvent<HTMLDivElement>) => {
    const hit = itemFromEvent(event);
    if (hit && !(event.target as Element).closest('[data-file-checkbox]')) openAt(hit.index);
  };

  // 拖曳已選取的項目 → 整批一起拖；拖曳沒選取的項目 → 只拖它（不改變選取，同作業系統的檔案總管）
  const onDragStart = (event: DragEvent<HTMLDivElement>) => {
    const hit = itemFromEvent(event);
    if (!hit) return;
    const draggedIds = selection.selected.has(hit.id) ? selection.selected : new Set([hit.id]);
    const dragged = items.filter((item) => draggedIds.has(item.id));
    // 批次移動不做一半：其中有不能移動的就整批不拖
    if (!canMove || dragged.some((item) => !item.canUpdate)) {
      event.preventDefault();
      return;
    }
    const [only] = dragged;
    itemDrag.startDrag(
      event,
      draggedItemsOf(dragged, currentFolderId),
      dragged.length === 1 && only
        ? only.name
        : t('file.move.dragLabel', { count: dragged.length }),
    );
  };

  return { onPointerDown, onClick, onDoubleClick, onDragStart, onToggle };
}
