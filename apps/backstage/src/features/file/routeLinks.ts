import { registerRouteLink } from '@/core/route-link';

import { FileListRoute } from './routes/pages';

/**
 * 後端連結用的 route id（docs/architecture/backend/15-notification.md §4.1）。這個 feature 是可啟用的：
 * 租戶沒啟用時沒有登記，連到資料夾的通知只顯示文字、不可點。
 */
export function registerFileRouteLinks(): void {
  registerRouteLink('file.folder', { route: FileListRoute, search: { folder: 'folderId' } });
}
