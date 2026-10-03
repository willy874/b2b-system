import { registerPreferenceTable } from '@/core/preference';

import { TENANT_LOCALE_SCOPE } from './locale';

/** 租戶清單的欄位設定 id（`RichTable` 的 `settings.tableId`、偏好頁的列表）。 */
export const TENANT_LIST_TABLE_ID = 'tenant-list';

/** 在 plugin 的同步階段呼叫：讓偏好頁不必進入租戶清單也能調整它的欄位。 */
export function registerTenantPreferences(): void {
  registerPreferenceTable({
    id: TENANT_LIST_TABLE_ID,
    labelI18nKey: 'tenant.title',
    columnLabelKeys: {
      code: 'tenant.field.code',
      name: 'tenant.field.name',
      status: 'tenant.field.status',
      domain: 'tenant.field.primaryDomain',
      createdAt: 'tenant.field.createdAt',
    },
    // 清單沒有批次操作，不提供勾選欄
    selectable: false,
    localeScope: TENANT_LOCALE_SCOPE,
  });
}
