import { lazy } from 'react';

import { PermissionKey } from '@/core/permission';
import { registerTrashType } from '@/core/trash';

import { GROUP_LOCALE_SCOPE } from './locale';

/** 還原按鈕只在回收桶頁渲染：以 `lazy()` 登記，按鈕與它用到的 mutation hook 不進首頁的初始載入（docs/architecture/frontend/13-trash.md）。 */
const GroupRestoreAction = lazy(() =>
  import('./components/GroupRestoreAction').then((module) => ({
    default: module.GroupRestoreAction,
  })),
);

/**
 * 在 plugin 的同步階段呼叫：回收桶頁多一個「群組」分頁（docs/architecture/frontend/13-trash.md）。
 * 看與還原都要 `group:delete`（docs/architecture/backend/14-revisions.md §9.2 D10），與後端 `GroupTrashHandler` 的 `permission` 相同。
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
