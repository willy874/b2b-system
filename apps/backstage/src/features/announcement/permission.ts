import {
  definePageKey,
  PermissionKey,
  PermissionMatch,
  PermissionResource,
  registerPagePermission,
  routeBasePath,
} from '@/core/permission';

import {
  ANNOUNCEMENT_MESSAGE_BASE_PATH,
  AnnouncementCreateRoute,
  AnnouncementListRoute,
} from './routes/pages';

export const ANNOUNCEMENT_PAGE = definePageKey('ANNOUNCEMENT');
/** 建立對話框是獨立的受管頁面（直接貼網址時要擋下）。 */
export const ANNOUNCEMENT_CREATE_PAGE = definePageKey('ANNOUNCEMENT_CREATE');
/** 收件人看全文：只需要登入（docs/architecture/backend/19-announcement.md §9.2 D4）。 */
export const ANNOUNCEMENT_MESSAGE_PAGE = definePageKey('ANNOUNCEMENT_MESSAGE');

export function registerAnnouncementPagePermissions(): void {
  registerPagePermission(ANNOUNCEMENT_PAGE, {
    route: routeBasePath(AnnouncementListRoute),
    rule: {
      resource: PermissionResource.ANNOUNCEMENT,
      access: [PermissionKey['announcement:read']],
      match: PermissionMatch.EVERY,
    },
  });
  registerPagePermission(ANNOUNCEMENT_CREATE_PAGE, {
    route: routeBasePath(AnnouncementCreateRoute),
    rule: {
      resource: PermissionResource.ANNOUNCEMENT,
      access: [PermissionKey['announcement:read'], PermissionKey['announcement:create']],
      match: PermissionMatch.EVERY,
    },
  });
  // `/announcement/message/…` 是 `/announcement` 的子路徑：頁面鍵取前綴最長的那一個。
  // 前綴比對不認得 `$dispatchId` 這種參數段，所以登記到參數之前的靜態部分
  registerPagePermission(ANNOUNCEMENT_MESSAGE_PAGE, {
    route: ANNOUNCEMENT_MESSAGE_BASE_PATH,
    rule: { access: [], match: PermissionMatch.EVERY },
  });
}
