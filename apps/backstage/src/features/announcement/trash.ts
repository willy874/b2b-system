import { lazy } from 'react';

import { PermissionKey } from '@/core/permission';
import { registerTrashType } from '@/core/trash';

import { ANNOUNCEMENT_LOCALE_SCOPE } from './locale';

/** 還原按鈕只在回收桶頁渲染：以 `lazy()` 登記，按鈕與它用到的 mutation hook 不進首頁的初始載入（docs/architecture/frontend/13-trash.md）。 */
const AnnouncementRestoreAction = lazy(() =>
  import('./components/AnnouncementRestoreAction').then((module) => ({
    default: module.AnnouncementRestoreAction,
  })),
);

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
