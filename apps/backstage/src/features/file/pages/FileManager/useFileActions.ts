import { useBatchQueue } from '@b2b-system/web-core/batch';
import { downloadSequentially } from '@b2b-system/web-core/data-transfer';
import { useTranslation } from '@b2b-system/web-core/locales';
import { useToast } from '@b2b-system/web-core/notify';
import { useCallback, useState } from 'react';

import { FILE_MANAGER_SCOPE, FileBatchOperation } from '../../batch';
import { useFileDeleteMutation } from '../../hooks/useFileMutations';
import { useFileMoveMutation, useFolderDeleteMutation } from '../../hooks/useFolderMutations';
import { isFileItem, isFolderItem } from './adapter';
import type { BrowserItemVM, FileItemVM } from './adapter';
import type { DraggedItems } from './useItemDrag';

/**
 * 檔案管理器的刪除、下載與移動：
 * - 單一檔案或資料夾直接呼叫單筆 API（有即時的成功／失敗提示）；資料夾是遞迴刪除
 * - 多個項目送進全域批次佇列逐筆刪除，檔案與資料夾各一個工作（進度、取消、結果由佇列處理；
 *   docs/architecture/frontend/07-ui-system.md §13）
 * - 移動（拖放、移動對話框）一次送出，後端在同一個交易內處理
 *
 * 只回傳操作，不訂閱佇列的進度：頁面每次呼叫它，訂閱會讓整頁跟著每個快照重繪（進度條是 `FileBatchProgress`）。
 */
export function useFileActions() {
  const { t } = useTranslation();
  const toast = useToast();
  const queue = useBatchQueue();
  const deleteOne = useFileDeleteMutation();
  const deleteFolder = useFolderDeleteMutation();
  const move = useFileMoveMutation();
  const [pendingDelete, setPendingDelete] = useState<readonly BrowserItemVM[]>();
  const [pendingMove, setPendingMove] = useState<DraggedItems>();

  const confirmDelete = useCallback(async () => {
    const targets = pendingDelete ?? [];
    const [only] = targets;
    if (targets.length === 1 && only) {
      const done =
        only.type === 'folder'
          ? deleteFolder.mutateAsync({ params: { folderId: only.id } })
          : deleteOne.mutateAsync({ params: { fileId: only.id } });
      await done.catch(() => undefined);
    } else if (targets.length > 1 && queue) {
      const files = targets.filter(isFileItem);
      const folders = targets.filter(isFolderItem);
      if (folders.length > 0) {
        queue.enqueue({
          operation: FileBatchOperation.DELETE_FOLDER,
          scope: FILE_MANAGER_SCOPE,
          items: folders.map((folder) => ({ id: folder.id, label: folder.name })),
        });
      }
      if (files.length > 0) {
        queue.enqueue({
          operation: FileBatchOperation.DELETE,
          scope: FILE_MANAGER_SCOPE,
          items: files.map((file) => ({ id: file.id, label: file.name })),
        });
      }
    }
    setPendingDelete(undefined);
    return targets;
  }, [deleteFolder, deleteOne, pendingDelete, queue]);

  const moveItems = useCallback(
    (items: DraggedItems, targetFolderId: string | undefined) =>
      move.mutateAsync({
        params: {
          fileIds: [...items.fileIds],
          folderIds: [...items.folderIds],
          targetFolderId: targetFolderId ?? null,
        },
      }),
    [move],
  );
  /** 拖放：錯誤已由 mutation 以 toast 顯示。 */
  const dropItems = useCallback(
    (items: DraggedItems, targetFolderId: string | undefined) =>
      void moveItems(items, targetFolderId).catch(() => undefined),
    [moveItems],
  );

  /** 依序觸發、最多 `DOWNLOAD_MAX` 個，超過時提示（與圖片庫相同）。 */
  const download = useCallback(
    (files: readonly FileItemVM[]) =>
      void downloadSequentially(files, {
        resolve: (file) =>
          file.downloadUrl ? { url: file.downloadUrl, fileName: file.name } : undefined,
        onLimited: (max) => toast.info(t('file.downloadLimited', { count: max })),
      }),
    [t, toast],
  );

  return {
    pendingDelete,
    requestDelete: setPendingDelete,
    cancelDelete: () => setPendingDelete(undefined),
    confirmDelete,
    deleting: deleteOne.isPending || deleteFolder.isPending,
    download,
    /** 移動對話框開著的項目。 */
    pendingMove,
    requestMove: setPendingMove,
    cancelMove: () => setPendingMove(undefined),
    moveItems,
    dropItems,
    moving: move.isPending,
  };
}
