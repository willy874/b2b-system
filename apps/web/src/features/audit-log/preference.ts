import { registerPreferenceTable } from '@/core/preference';

import { AUDIT_LOG_LOCALE_SCOPE } from './locale';

/** 稽核日誌列表的欄位設定 id（`RichTable` 的 `settings.tableId`、偏好頁的列表）。 */
export const AUDIT_LOG_LIST_TABLE_ID = 'audit-log-list';

/** 在 plugin 的同步階段呼叫：讓偏好頁不必進入稽核日誌也能調整它的欄位。 */
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
    localeScope: AUDIT_LOG_LOCALE_SCOPE,
  });
}
