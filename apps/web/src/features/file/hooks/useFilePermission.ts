import { usePagePermission } from '@/core/permission';

import { FILE_PAGE } from '../permission';

/**
 * 檔案管理器的權限 facade：上傳與建立資料夾 `file:create`、改名與移動 `file:update`、
 * 刪除（含遞迴刪除資料夾）`file:delete`。
 * 權限還沒水合時一律為 false：上傳鈕、刪除鈕不會先出現再消失。
 */
export function useFilePermission() {
  const page = usePagePermission(FILE_PAGE);
  return {
    ...page,
    canUpload: page.hydrated && page.canCreate,
    canCreateFolder: page.hydrated && page.canCreate,
    canRename: page.hydrated && page.canUpdate,
    canMove: page.hydrated && page.canUpdate,
    canDelete: page.hydrated && page.canDelete,
  };
}
