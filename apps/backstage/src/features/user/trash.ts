import { PermissionKey } from '@/core/permission';
import { registerTrashType } from '@/core/trash';

import { UserRestoreAction } from './components/UserRestoreAction';
import { USER_LOCALE_SCOPE } from './locale';

/**
 * 在 plugin 的同步階段呼叫：回收桶頁多一個「使用者」分頁（docs/architecture/frontend/13-trash.md）。
 * 看與還原都要 `user:delete`（ADR-0025 D10），與後端 `UserTrashHandler` 的 `permission` 相同。
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
