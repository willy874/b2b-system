import { registerPreferenceTable } from '@b2b-system/web-core/preference';

import { PLATFORM_ADMIN_LOCALE_SCOPE } from './locale';

/** 平台管理者列表的欄位設定 id（`RichTable` 的 `settings.tableId`、偏好頁的列表）。 */
export const PLATFORM_ADMIN_LIST_TABLE_ID = 'platform-admin-list';

/** 在 plugin 的同步階段呼叫：讓偏好頁不必進入平台管理者列表也能調整它的欄位。 */
export function registerPlatformAdminPreferences(): void {
  registerPreferenceTable({
    id: PLATFORM_ADMIN_LIST_TABLE_ID,
    labelI18nKey: 'platformAdmin.title',
    columnLabelKeys: {
      displayName: 'platformAdmin.field.displayName',
      email: 'platformAdmin.field.email',
      role: 'platformAdmin.field.role',
      status: 'platformAdmin.field.status',
      lastLoginAt: 'platformAdmin.field.lastLoginAt',
    },
    // 沒有批次操作：不提供勾選欄（列表的 enableRowSelection={false}）
    selectable: false,
    localeScope: PLATFORM_ADMIN_LOCALE_SCOPE,
  });
}
