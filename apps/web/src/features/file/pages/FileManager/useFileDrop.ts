import { useCallback, useRef, useState } from 'react';
import type { DragEvent } from 'react';

function hasFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer.types).includes('Files');
}

/** 拖進來的東西拆成檔案與資料夾（資料夾不支援：沒有階層的檔案管理器上傳資料夾只會攤平）。 */
function collect(dataTransfer: DataTransfer): { files: File[]; directories: number } {
  const files: File[] = [];
  let directories = 0;
  const items = Array.from(dataTransfer.items ?? []);
  if (items.length === 0) return { files: Array.from(dataTransfer.files), directories };
  for (const item of items) {
    if (item.kind !== 'file') continue;
    const entry = item.webkitGetAsEntry?.();
    if (entry?.isDirectory) {
      directories += 1;
      continue;
    }
    const file = item.getAsFile();
    if (file) files.push(file);
  }
  return { files, directories };
}

interface UseFileDropOptions {
  enabled: boolean;
  onFiles: (files: File[]) => void;
  onDirectories?: (count: number) => void;
}

/**
 * 把檔案拖到主區塊上傳。`dragenter` / `dragleave` 會在子元素之間成對觸發，以計數判斷是否真的離開；
 * 只對「帶檔案」的拖曳反應，頁面內拖動文字或圖片不會出現遮罩。
 */
export function useFileDrop({ enabled, onFiles, onDirectories }: UseFileDropOptions) {
  const [isDragging, setDragging] = useState(false);
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
    },
    [enabled],
  );
  const onDragLeave = useCallback(
    (event: DragEvent) => {
      if (!enabled || !hasFiles(event)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setDragging(false);
    },
    [enabled],
  );
  const onDrop = useCallback(
    (event: DragEvent) => {
      if (!enabled || !hasFiles(event)) return;
      event.preventDefault();
      depth.current = 0;
      setDragging(false);
      const { files, directories } = collect(event.dataTransfer);
      if (directories > 0) onDirectories?.(directories);
      if (files.length > 0) onFiles(files);
    },
    [enabled, onDirectories, onFiles],
  );

  return { isDragging, dropHandlers: { onDragEnter, onDragOver, onDragLeave, onDrop } };
}
