import { useCallback, useRef, useState } from 'react';
import type { DragEvent } from 'react';

import { collectFromDataTransfer } from '../../upload/collectEntries';
import type { CollectedUpload } from '../../upload/collectEntries';
import { dropFolderOf } from './useItemDrag';

function hasFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer.types).includes('Files');
}

interface UseFileDropOptions {
  enabled: boolean;
  /**
   * `folderId`：放在某個資料夾（卡片、列表列）上時是那個資料夾；放在空白處是 undefined（目前的資料夾）。
   */
  onDrop: (upload: CollectedUpload, folderId: string | undefined) => void;
}

/**
 * 把電腦裡的檔案或資料夾拖到主區塊上傳（資料夾保留結構）。
 * `dragenter` / `dragleave` 會在子元素之間成對觸發，以計數判斷是否真的離開；
 * 只對「帶檔案」的拖曳反應——頁面內拖動文字、圖片，或拖動主區塊裡的項目（移動）都不會出現遮罩。
 */
export function useFileDrop({ enabled, onDrop }: UseFileDropOptions) {
  const [isDragging, setDragging] = useState(false);
  /** 游標下的資料夾（放開就上傳到那裡）。 */
  const [overFolder, setOverFolder] = useState<string>();
  const depth = useRef(0);

  const onDragEnter = useCallback(
    (event: DragEvent) => {
      if (!enabled || !hasFiles(event)) return;
      event.preventDefault();
      depth.current += 1;
      setDragging(true);
    },
    [enabled],
  );
  const onDragOver = useCallback(
    (event: DragEvent) => {
      if (!enabled || !hasFiles(event)) return;
      // 不 preventDefault 就不會觸發 drop，瀏覽器會直接打開檔案
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
      setOverFolder(dropFolderOf(event.target));
    },
    [enabled],
  );
  const onDragLeave = useCallback(
    (event: DragEvent) => {
      if (!enabled || !hasFiles(event)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) {
        setDragging(false);
        setOverFolder(undefined);
      }
    },
    [enabled],
  );
  const handleDrop = useCallback(
    (event: DragEvent) => {
      if (!enabled || !hasFiles(event)) return;
      event.preventDefault();
      depth.current = 0;
      setDragging(false);
      setOverFolder(undefined);
      const folderId = dropFolderOf(event.target);
      // 同步取出項目（Entry API 只在事件當下有效），再非同步展開資料夾
      void collectFromDataTransfer(event.dataTransfer).then((upload) => {
        if (upload.entries.length > 0 || upload.directories.length > 0) onDrop(upload, folderId);
      });
    },
    [enabled, onDrop],
  );

  return {
    isDragging,
    overFolder,
    dropHandlers: { onDragEnter, onDragOver, onDragLeave, onDrop: handleDrop },
  };
}
