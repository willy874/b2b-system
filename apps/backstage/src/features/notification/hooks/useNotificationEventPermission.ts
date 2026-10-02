import { usePagePermission } from '@/core/permission';

import { NOTIFICATION_EVENT_PAGE } from '../permission';

/** 事件管理頁：`system:read` 檢視，`system:update`（`canUpdate`）開關與還原預設（docs/architecture/backend/16-notification-event.md §9.2 D10）。 */
export function useNotificationEventPermission() {
  return usePagePermission(NOTIFICATION_EVENT_PAGE);
}
