import { PermissionKey } from '@/core/permission';
import { registerTrashType } from '@/core/trash';

import { RoleRestoreAction } from './components/RoleRestoreAction';
import { ROLE_LOCALE_SCOPE } from './locale';

/**
 * 在 plugin 的同步階段呼叫：回收桶頁多一個「角色」分頁（docs/architecture/frontend/13-trash.md）。
 * 看與還原都要 `role:delete`（docs/architecture/backend/14-revisions.md §9.2 D10），與後端 `RoleTrashHandler` 的 `permission` 相同。
 */
export function registerRoleTrashType(): void {
  registerTrashType({
    type: 'role',
    order: 20,
    labelI18nKey: 'menu.role',
    permission: PermissionKey['role:delete'],
    localeScope: ROLE_LOCALE_SCOPE,
    RestoreAction: RoleRestoreAction,
  });
}
