import { PermissionKey } from '@/core/permission';
import { registerTrashType } from '@/core/trash';

import { OrgUnitRestoreAction } from './components/OrgUnitRestoreAction';
import { ORGANIZATION_LOCALE_SCOPE } from './locale';

/**
 * 在 plugin 的同步階段呼叫：回收桶頁多一個「部門」分頁（docs/architecture/frontend/13-trash.md）。
 * 看與還原都要 `orgUnit:delete`，與後端 `OrgUnitTrashHandler` 的 `permission` 相同。
 */
export function registerOrganizationTrashType(): void {
  registerTrashType({
    type: 'orgUnit',
    order: 27,
    labelI18nKey: 'menu.organization',
    permission: PermissionKey['orgUnit:delete'],
    localeScope: ORGANIZATION_LOCALE_SCOPE,
    RestoreAction: OrgUnitRestoreAction,
  });
}
