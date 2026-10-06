import { useMemo } from 'react';

import { PermissionKey, usePagePermission, usePermission } from '@/core/permission';

import { ANNOUNCEMENT_PAGE } from '../permission';

/**
 * 頁面元件只呼叫這一個 hook，不直接比對權限鍵。`publish` 不是 CRUD：送出、暫停與恢復、撤回、
 * 修改已送出的公告都要它（docs/architecture/backend/19-announcement.md §9.2 D15）。
 */
export function useAnnouncementPermission() {
  const page = usePagePermission(ANNOUNCEMENT_PAGE);
  const { can } = usePermission();
  // 權限沒變時回傳同一個物件（列表的 rows 等 memo 以它或它的欄位為依賴）
  return useMemo(
    () => ({ ...page, canPublish: can(PermissionKey['announcement:publish']) }),
    [page, can],
  );
}
