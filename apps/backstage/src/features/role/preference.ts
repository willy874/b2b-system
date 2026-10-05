import { registerPreferenceTable } from '@b2b-system/web-core/preference';

import { ROLE_LOCALE_SCOPE } from './locale';

/** 角色列表的欄位設定 id（`RichTable` 的 `settings.tableId`、偏好頁的列表）。 */
export const ROLE_LIST_TABLE_ID = 'role-list';

/** 在 plugin 的同步階段呼叫：讓偏好頁不必進入角色列表也能調整它的欄位。 */
export function registerRolePreferences(): void {
  registerPreferenceTable({
    id: ROLE_LIST_TABLE_ID,
    labelI18nKey: 'role.list.title',
    columnLabelKeys: {
      name: 'role.field.name',
      slug: 'role.field.slug',
      description: 'role.field.description',
      isSystem: 'role.field.type',
      permissionCount: 'role.field.permissionCount',
      userCount: 'role.field.userCount',
      createdAt: 'role.field.createdAt',
    },
    localeScope: ROLE_LOCALE_SCOPE,
  });
}
