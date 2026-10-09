import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { DragEvent } from 'react';

import { collectFromDataTransfer } from '@/core/upload';

interface UseGalleryDropOptions {
  enabled: boolean;
  onFiles: (files: File[]) => void;
}

function hasFiles(event: DragEvent): boolean {
  return event.dataTransfer.types.includes('Files');
}

/**
 * 拖曳與貼上上傳（docs/architecture/frontend/24-gallery.md §4）：拖進資料夾時只取裡面的圖片、不保留結構（`core/upload` 展開）；
 * 貼上（⌘V／Ctrl+V）只在焦點不在輸入框時攔截，而且貼的要是圖片。
 */
export function useGalleryDrop({ enabled, onFiles }: UseGalleryDropOptions) {
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);
  const latest = useRef(onFiles);
  useLayoutEffect(() => {
    latest.current = onFiles;
  });

  useEffect(() => {
    if (!enabled) return undefined;
    const onPaste = (event: ClipboardEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (target?.closest('input, textarea, [contenteditable]')) return;
      const files = [...(event.clipboardData?.files ?? [])].filter((file) =>
        file.type.startsWith('image/'),
      );
      if (files.length === 0) return;
      event.preventDefault();
      latest.current(files);
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [enabled]);

  const handlers = enabled
    ? {
        onDragEnter: (event: DragEvent) => {
          if (!hasFiles(event)) return;
          depth.current += 1;
          setDragging(true);
        },
        onDragOver: (event: DragEvent) => {
          if (hasFiles(event)) event.preventDefault();
        },
        onDragLeave: () => {
          depth.current = Math.max(0, depth.current - 1);
          if (depth.current === 0) setDragging(false);
        },
        onDrop: (event: DragEvent) => {
          if (!hasFiles(event)) return;
          event.preventDefault();
          depth.current = 0;
          setDragging(false);
          // 要在事件的同步階段取出項目（`collectFromDataTransfer` 在第一個 await 之前就取完）
          void collectFromDataTransfer(event.dataTransfer).then((collected) =>
            latest.current(collected.entries.map((entry) => entry.file)),
          );
        },
      }
    : {};

  return { dragging, handlers };
}
