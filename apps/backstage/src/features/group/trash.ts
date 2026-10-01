import { PermissionKey } from '@/core/permission';
import { registerTrashType } from '@/core/trash';

import { GroupRestoreAction } from './components/GroupRestoreAction';
import { GROUP_LOCALE_SCOPE } from './locale';

/**
 * 在 plugin 的同步階段呼叫：回收桶頁多一個「群組」分頁（docs/architecture/frontend/13-trash.md）。
 * 看與還原都要 `group:delete`（ADR-0025 D10），與後端 `GroupTrashHandler` 的 `permission` 相同。
 */
export function registerGroupTrashType(): void {
  registerTrashType({
    type: 'group',
    order: 25,
    labelI18nKey: 'menu.userGroup',
    permission: PermissionKey['group:delete'],
    localeScope: GROUP_LOCALE_SCOPE,
    RestoreAction: GroupRestoreAction,
  });
}
