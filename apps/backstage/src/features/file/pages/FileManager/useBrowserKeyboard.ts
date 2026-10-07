import { useState } from 'react';
import type { KeyboardEvent } from 'react';

import type { BrowserItemVM, BrowserSlot } from './adapter';
import { moveIndex } from './layout';
import type { FileLayout } from './layout';
import type { FileSelection } from './useFileSelection';

type NavigationKey = 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight' | 'Home' | 'End';
const NAVIGATION_KEYS: ReadonlySet<string> = new Set([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Home',
  'End',
]);

export interface UseBrowserKeyboardOptions {
  /** 格（含佔位）：焦點的索引是格的索引。 */
  items: readonly BrowserSlot[];
  layout: FileLayout;
  selection: FileSelection;
  /** 所在的資料夾：換資料夾時焦點不留在同一個位置上 */
  currentFolderId: string | undefined;
  onOpen: (item: BrowserItemVM) => void;
  onDeleteSelected: () => void;
  /** 把焦點項目捲進可視範圍 */
  scrollToIndex: (index: number) => void;
}

/**
 * 檔案瀏覽區的焦點與鍵盤（docs/architecture/frontend/12-file-manager.md §7）：
 * 方向鍵／Home／End 移動焦點並選取（Shift 延伸、Ctrl／⌘ 只移焦點）、空白鍵切換、Enter 開啟、
 * Ctrl+A 全選、Esc 取消選取、Delete／Backspace 刪除選取的項目。
 * 容器是 listbox，焦點以 `aria-activedescendant` 指向 `focused`。
 */
export function useBrowserKeyboard({
  items,
  layout,
  selection,
  currentFolderId,
  onOpen,
  onDeleteSelected,
  scrollToIndex,
}: UseBrowserKeyboardOptions) {
  const [focusIndex, setFocusIndex] = useState(-1);
  // 換資料夾：焦點不留在新資料夾的同一個位置上（render 期間調整 state，不經過 effect）
  const [focusFolder, setFocusFolder] = useState(currentFolderId);
  if (focusFolder !== currentFolderId) {
    setFocusFolder(currentFolderId);
    setFocusIndex(-1);
  }
  const focused = items[focusIndex];

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    if (NAVIGATION_KEYS.has(event.key)) {
      event.preventDefault();
      const next = moveIndex(layout, focusIndex, event.key as NavigationKey, items.length);
      const id = items[next]?.id;
      if (id === undefined) return;
      setFocusIndex(next);
      scrollToIndex(next);
      if (event.shiftKey) selection.click(id, { shift: true });
      else if (!(event.metaKey || event.ctrlKey)) selection.click(id);
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      selection.selectAll();
      return;
    }
    switch (event.key) {
      case ' ':
        if (focused) {
          event.preventDefault();
          selection.click(focused.id, { toggle: true });
        }
        return;
      case 'Enter':
        if (focused) {
          event.preventDefault();
          onOpen(focused);
        }
        return;
      case 'Escape':
        if (selection.selected.size > 0) {
          event.preventDefault();
          selection.clear();
        }
        return;
      case 'Delete':
      case 'Backspace':
        if (selection.selected.size > 0) {
          event.preventDefault();
          onDeleteSelected();
        }
        return;
      default:
        return;
    }
  };

  return { focusIndex, focused, setFocusIndex, onKeyDown };
}
