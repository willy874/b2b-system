import { useState } from 'react';

import type { BrowserItemVM } from './adapter';

/** 共用、申請存取的對象：資料夾的 id 與名稱（目前位置或選取的項目）。 */
export interface FolderTarget {
  id: string;
  name: string;
}

/**
 * 檔案管理器的「共用」「申請存取」「標籤」對話框的對象（與 `useRenameTarget` 同樣的寫法）：
 * 有對象就開著，關閉時清空。傳入 `undefined`（例：沒有選取）時不開。
 */
export function useFileDialogs() {
  const [shareTarget, setShareTarget] = useState<FolderTarget>();
  const [requestTarget, setRequestTarget] = useState<FolderTarget>();
  const [tagTarget, setTagTarget] = useState<BrowserItemVM>();

  return {
    shareTarget,
    requestTarget,
    tagTarget,
    share: (folder: FolderTarget | undefined) => folder && setShareTarget(folder),
    requestAccess: (folder: FolderTarget | undefined) => folder && setRequestTarget(folder),
    tag: (item: BrowserItemVM | undefined) => setTagTarget(item),
    closeShare: () => setShareTarget(undefined),
    closeRequest: () => setRequestTarget(undefined),
    closeTag: () => setTagTarget(undefined),
  };
}

export type FileDialogs = ReturnType<typeof useFileDialogs>;
