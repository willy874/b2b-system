import { lazy } from 'react';

import { PermissionKey } from '@/core/permission';
import { registerTrashType } from '@/core/trash';

import { ORGANIZATION_LOCALE_SCOPE } from './locale';

/** 還原按鈕只在回收桶頁渲染：以 `lazy()` 登記，按鈕與它用到的 mutation hook 不進首頁的初始載入（docs/architecture/frontend/13-trash.md）。 */
const OrgUnitRestoreAction = lazy(() =>
  import('./components/OrgUnitRestoreAction').then((module) => ({
    default: module.OrgUnitRestoreAction,
  })),
);

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
