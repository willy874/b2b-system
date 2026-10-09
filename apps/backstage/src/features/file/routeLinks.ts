import { registerRouteLink } from '@b2b-system/web-core/route-link';

import { FileListRoute } from './routes/pages';

/**
 * 後端連結用的 route id（docs/architecture/backend/15-notification.md §4.1）。這個 feature 是可啟用的：
 * 租戶沒啟用時沒有登記，連到資料夾的通知只顯示文字、不可點。
 */
export function registerFileRouteLinks(): void {
  registerRouteLink('file.folder', { route: FileListRoute, search: { folder: 'folderId' } });
  // 命令面板的檔案搜尋：打開檔案所在的資料夾並預覽它（根目錄的檔案沒有資料夾參數，所以分成兩個 id）
  registerRouteLink('file.preview', { route: FileListRoute, search: { preview: 'fileId' } });
  registerRouteLink('file.folderPreview', {
    route: FileListRoute,
    search: { folder: 'folderId', preview: 'fileId' },
  });
  // 審批詳情的「修改後重新送出」：打開資料夾的申請對話框，預填等級並帶上前一筆
  registerRouteLink('file.requestAccess', {
    route: FileListRoute,
    search: { folder: 'folderId', requestAccess: 'level', resubmit: 'approvalId' },
  });
}
