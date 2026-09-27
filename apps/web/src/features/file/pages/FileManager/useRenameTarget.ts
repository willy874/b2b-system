import { useState } from 'react';

import type { BrowserItemVM, FileItemVM } from './adapter';
import type { FolderDialogTarget } from './components/FileFolderDialog';

/**
 * 改名與新增資料夾的對話框狀態。檔案與資料夾用不同的對話框：檔案帶樂觀鎖的版本號，資料夾沒有。
 * 檔案的改名對話框跟著最新的資料（別人改名後版本號更新）；LightBox 從深連結開啟、不在列表裡時用開啟當下的資料。
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
