import { PermissionKey, usePagePermission, usePermission } from '@/core/permission';

import { ANNOUNCEMENT_PAGE } from '../permission';

/**
 * 頁面元件只呼叫這一個 hook，不直接比對權限鍵。`publish` 不是 CRUD：送出、暫停與恢復、撤回、
 * 修改已送出的公告都要它（docs/adr/0031-announcements.md D15）。
 */
export function useAnnouncementPermission() {
  const page = usePagePermission(ANNOUNCEMENT_PAGE);
  const { can } = usePermission();
  return { ...page, canPublish: can(PermissionKey['announcement:publish']) };
}
