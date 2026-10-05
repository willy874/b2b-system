import { registerPreferenceTable } from '@b2b-system/web-core/preference';

import { FEATURE_FLAG_LOCALE_SCOPE } from './locale';

/** 試行開關列表的欄位設定 id（`RichTable` 的 `settings.tableId`、偏好頁的列表）。 */
export const FEATURE_FLAG_LIST_TABLE_ID = 'feature-flag-list';

/** 在 plugin 的同步階段呼叫：讓偏好頁不必進入試行開關也能調整它的欄位。 */
export function registerFeatureFlagPreferences(): void {
  registerPreferenceTable({
    id: FEATURE_FLAG_LIST_TABLE_ID,
    labelI18nKey: 'featureFlag.title',
    columnLabelKeys: {
      key: 'featureFlag.field.key',
      owner: 'featureFlag.field.owner',
      removeBy: 'featureFlag.field.removeBy',
      default: 'featureFlag.field.default',
      tenantOverrides: 'featureFlag.field.tenantOverrides',
      global: 'featureFlag.field.global',
    },
    // 沒有批次操作：不提供勾選欄（列表的 enableRowSelection={false}）
    selectable: false,
    localeScope: FEATURE_FLAG_LOCALE_SCOPE,
  });
}
