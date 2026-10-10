import { lazy } from 'react';

import { PermissionKey } from '@/core/permission';
import { registerTrashType } from '@/core/trash';

import { USER_LOCALE_SCOPE } from './locale';

/** 還原按鈕只在回收桶頁渲染：以 `lazy()` 登記，按鈕與它用到的 mutation hook 不進首頁的初始載入（docs/architecture/frontend/13-trash.md）。 */
const UserRestoreAction = lazy(() =>
  import('./components/UserRestoreAction').then((module) => ({
    default: module.UserRestoreAction,
  })),
);

/**
 * 在 plugin 的同步階段呼叫：回收桶頁多一個「使用者」分頁（docs/architecture/frontend/13-trash.md）。
 * 看與還原都要 `user:delete`（docs/architecture/backend/14-revisions.md §9.2 D10），與後端 `UserTrashHandler` 的 `permission` 相同。
 */
export function registerUserTrashType(): void {
  registerTrashType({
    type: 'user',
    order: 10,
    labelI18nKey: 'menu.user',
    permission: PermissionKey['user:delete'],
    localeScope: USER_LOCALE_SCOPE,
    RestoreAction: UserRestoreAction,
  });
}
