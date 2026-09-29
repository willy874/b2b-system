import { useCallback, useRef, useState } from 'react';
import type { DragEvent } from 'react';

import { canMoveFoldersTo, ROOT_FOLDER } from './folderTree';
import type { FolderIndex } from './folderTree';

/**
 * 頁面內拖曳項目的資料型別。`dataTransfer` 只帶這個標記；拖了哪些項目記在 hook 裡——
 * `dragover` 期間瀏覽器不讓讀 `getData()`，放開之前就得知道能不能放。
 */
export const ITEM_DRAG_TYPE = 'application/x-game-editor-file-items';

/**
 * 放置目標以 `data-drop-folder` 標出：值是資料夾 id，根目錄是空字串。
 * 主區塊的資料夾卡片、麵包屑、樹狀面板共用：容器上掛一組 handler，以事件委派找出目標。
 */
export const DROP_FOLDER_ATTR = 'data-drop-folder';

/** 事件目標所在的放置目標；`folderId` undefined 是根目錄。不在任何目標上時回 undefined。 */
export function dropTargetOf(
  target: EventTarget | null,
): { folderId: string | undefined } | undefined {
  const element = target instanceof Element ? target.closest(`[${DROP_FOLDER_ATTR}]`) : null;
  if (!element) return undefined;
  return { folderId: element.getAttribute(DROP_FOLDER_ATTR) || undefined };
}

/** 從電腦拖檔案進來時用：只看資料夾（根目錄的目標不在主區塊裡）。 */
export function dropFolderOf(target: EventTarget | null): string | undefined {
  return dropTargetOf(target)?.folderId;
}

export interface DraggedItems {
  fileIds: readonly string[];
  folderIds: readonly string[];
  /** 拖曳開始的位置（項目目前所在的資料夾）；放回原處不算移動。 */
  sourceFolderId: string | undefined;
}

/** 選取（或拖曳）的項目依種類分開；拖放與移動對話框送出的形狀。 */
export function draggedItemsOf(
  items: readonly { id: string; type: 'file' | 'folder' }[],
  sourceFolderId: string | undefined,
): DraggedItems {
  return {
    fileIds: items.filter((item) => item.type === 'file').map((item) => item.id),
    folderIds: items.filter((item) => item.type === 'folder').map((item) => item.id),
    sourceFolderId,
  };
}

interface UseItemDragOptions {
  enabled: boolean;
  folders: FolderIndex;
  onMove: (items: DraggedItems, targetFolderId: string | undefined) => void;
}

function isItemDrag(event: DragEvent): boolean {
  return Array.from(event.dataTransfer.types).includes(ITEM_DRAG_TYPE);
}

/** 拖曳時跟著游標的小標籤（「3 個項目」）；比瀏覽器預設的整張卡片半透明截圖清楚。 */
function setDragPreview(dataTransfer: DataTransfer, label: string): void {
  const preview = document.createElement('div');
  preview.textContent = label;
  preview.className =
    'fixed -top-96 left-0 rounded-md bg-[var(--color-brand)] px-2.5 py-1 text-xs font-medium text-[var(--color-brand-fg)] shadow-[var(--shadow-popover)]';
  document.body.append(preview);
  dataTransfer.setDragImage(preview, -12, -12);
  // 瀏覽器在 dragstart 當下截圖，之後就可以移除
  requestAnimationFrame(() => preview.remove());
}

/**
 * 在檔案管理器裡拖曳檔案與資料夾，放到資料夾（卡片、麵包屑、樹狀面板）上移動
 * （docs/architecture/frontend/12-file-manager.md §12）。
 *
 * - 資料夾不能放進自己或自己的子孫（與後端的 `FILE_FOLDER_CYCLE` 同一條規則），放回原處也不算；
 *   不合法的目標以 `dropEffect = 'none'` 讓游標顯示禁止。
 * - 只接受頁面內的拖曳（`ITEM_DRAG_TYPE`）；從電腦拖進來的檔案由 `useFileDrop` 處理。
 */
export function useItemDrag({ enabled, folders, onMove }: UseItemDragOptions) {
  const dragged = useRef<DraggedItems>(undefined);
  const [isDragging, setDragging] = useState(false);
  /** 游標下、可以放的目標（資料夾 id；根目錄是 `ROOT_FOLDER`）。 */
  const [overKey, setOverKey] = useState<string>();

  const canDropOn = useCallback(
    (targetFolderId: string | undefined) => {
      const items = dragged.current;
      if (!items) return false;
      if (targetFolderId === items.sourceFolderId) return false;
      return canMoveFoldersTo(folders, items.folderIds, targetFolderId);
    },
    [folders],
  );

  const startDrag = useCallback(
    (event: DragEvent, items: DraggedItems, label: string) => {
      if (!enabled || items.fileIds.length + items.folderIds.length === 0) {
        event.preventDefault();
        return;
      }
      dragged.current = items;
      setDragging(true);
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData(ITEM_DRAG_TYPE, '1');
      setDragPreview(event.dataTransfer, label);
    },
    [enabled],
  );

  const endDrag = useCallback(() => {
    dragged.current = undefined;
    setDragging(false);
    setOverKey(undefined);
  }, []);

  const onDragOver = useCallback(
    (event: DragEvent) => {
      if (!isItemDrag(event)) return;
      const target = dropTargetOf(event.target);
      const allowed = target !== undefined && canDropOn(target.folderId);
      // 不合法也要 preventDefault：否則外層（上傳用的 drop 區）會以為是別的拖曳
      event.preventDefault();
      event.dataTransfer.dropEffect = allowed ? 'move' : 'none';
      setOverKey(allowed ? (target.folderId ?? ROOT_FOLDER) : undefined);
    },
    [canDropOn],
  );

  const onDragLeave = useCallback((event: DragEvent) => {
    if (!isItemDrag(event)) return;
    // 移到同一個目標裡的子元素也會觸發 dragleave：只有離開目標本身才清掉
    const next = event.relatedTarget;
    if (!(next instanceof Node) || !event.currentTarget.contains(next)) setOverKey(undefined);
  }, []);

  const onDrop = useCallback(
    (event: DragEvent) => {
      if (!isItemDrag(event)) return;
      event.preventDefault();
      const target = dropTargetOf(event.target);
      const items = dragged.current;
      if (items && target && canDropOn(target.folderId)) onMove(items, target.folderId);
      endDrag();
    },
    [canDropOn, endDrag, onMove],
  );

  return {
    isDragging,
    /** 游標正停在這個目標上且可以放（`undefined` 是根目錄）。 */
    isOver: (folderId: string | undefined) =>
      overKey !== undefined && overKey === (folderId ?? ROOT_FOLDER),
    startDrag,
    endDrag,
    /** 掛在包住放置目標的容器上（主區塊、麵包屑、樹狀面板）。 */
    dropHandlers: { onDragOver, onDragLeave, onDrop },
  };
}

export type ItemDrag = ReturnType<typeof useItemDrag>;
