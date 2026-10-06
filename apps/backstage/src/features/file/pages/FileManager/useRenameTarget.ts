import { useState } from 'react';

import type { BrowserItemVM, FileItemVM } from './adapter';
import type { FolderDialogTarget } from './components/FileFolderDialog';

/**
 * 改名與新增資料夾的對話框狀態。檔案與資料夾用不同的對話框：檔案帶樂觀鎖的版本號，資料夾沒有。
 * 回傳的檔案跟著列表最新的資料（LightBox 從深連結開啟、不在列表裡時用開啟當下的資料）；
 * 送出時帶的版本號由 `FileRenameDialog` 在開啟時記下，不跟著這裡更新（衝突要按「重新載入」才換）。
 */
export function useRenameTarget(files: readonly FileItemVM[]) {
  const [fileId, setFileId] = useState<string>();
  const [fallback, setFallback] = useState<FileItemVM>();
  const [folderDialog, setFolderDialog] = useState<FolderDialogTarget>();
  const renameFile = (file: FileItemVM) => {
    setFallback(file);
    setFileId(file.id);
  };

  return {
    file: fileId ? (files.find((item) => item.id === fileId) ?? fallback) : undefined,
    folderDialog,
    renameFile,
    rename: (item: BrowserItemVM) =>
      item.type === 'folder' ? setFolderDialog({ mode: 'rename', folder: item }) : renameFile(item),
    createFolder: (parentId: string | undefined) => setFolderDialog({ mode: 'create', parentId }),
    closeFile: () => setFileId(undefined),
    closeFolder: () => setFolderDialog(undefined),
  };
}
