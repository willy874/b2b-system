import { registerPreferenceTable } from '@/core/preference';

import { USER_LOCALE_SCOPE } from './locale';

/** 使用者列表的欄位設定 id（`RichTable` 的 `settings.tableId`、偏好頁的列表）。 */
export const USER_LIST_TABLE_ID = 'user-list';

/** 在 plugin 的同步階段呼叫：讓偏好頁不必進入使用者列表也能調整它的欄位。 */
export function registerUserPreferences(): void {
  registerPreferenceTable({
    id: USER_LIST_TABLE_ID,
    labelI18nKey: 'user.list.title',
    columnLabelKeys: {
      displayName: 'user.field.displayName',
      email: 'user.field.email',
      status: 'user.field.status',
      roles: 'user.field.roles',
      tags: 'user.field.tags',
      lastLoginAt: 'user.field.lastLoginAt',
    },
    localeScope: USER_LOCALE_SCOPE,
  });
}
