import { SELECT_COLUMN_ID } from '@b2b-system/ui/Table';
import { registerPreferenceTable } from '@b2b-system/web-core/preference';

import { AUDIT_LOG_LOCALE_SCOPE } from './locale';

/** 平台稽核列表的欄位設定 id（`RichTable` 的 `settings.tableId`、偏好頁的列表）。 */
export const AUDIT_LOG_LIST_TABLE_ID = 'platform-audit-log-list';

/** 稽核紀錄不可變、沒有批次操作，勾選欄預設隱藏；需要時在欄位設定打開。 */
export const AUDIT_LOG_LIST_DEFAULT_HIDDEN: readonly string[] = [SELECT_COLUMN_ID];

/** 在 plugin 的同步階段呼叫：讓偏好頁不必進入平台稽核也能調整它的欄位。 */
export function registerAuditLogPreferences(): void {
  registerPreferenceTable({
    id: AUDIT_LOG_LIST_TABLE_ID,
    labelI18nKey: 'auditLog.title',
    columnLabelKeys: {
      occurredAt: 'auditLog.field.occurredAt',
      actorEmail: 'auditLog.field.actor',
      action: 'auditLog.field.action',
      resource: 'auditLog.field.resource',
      result: 'auditLog.field.result',
    },
    defaultHidden: AUDIT_LOG_LIST_DEFAULT_HIDDEN,
    localeScope: AUDIT_LOG_LOCALE_SCOPE,
  });
}
