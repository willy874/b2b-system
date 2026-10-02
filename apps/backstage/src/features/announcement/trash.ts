import { PermissionKey } from '@/core/permission';
import { registerTrashType } from '@/core/trash';

import { AnnouncementRestoreAction } from './components/AnnouncementRestoreAction';
import { ANNOUNCEMENT_LOCALE_SCOPE } from './locale';

/**
 * 在 plugin 的同步階段呼叫：回收桶頁多一個「公告」分頁（docs/architecture/frontend/13-trash.md）。
 * 看與還原都要 `announcement:delete`，與後端 `AnnouncementTrashHandler` 的 `permission` 相同。
 */
export function registerAnnouncementTrashType(): void {
  registerTrashType({
    type: 'announcement',
    order: 60,
    labelI18nKey: 'menu.announcement',
    permission: PermissionKey['announcement:delete'],
    localeScope: ANNOUNCEMENT_LOCALE_SCOPE,
    RestoreAction: AnnouncementRestoreAction,
  });
}
