import { registerPreferenceTable } from '@/core/preference';

import { APPROVAL_LOCALE_SCOPE } from './locale';

/** 審批列表的欄位設定 id（`RichTable` 的 `settings.tableId`、偏好頁的列表）。 */
export const APPROVAL_LIST_TABLE_ID = 'approval-list';

/** 在 plugin 的同步階段呼叫：讓偏好頁不必進入審批列表也能調整它的欄位。 */
export function registerApprovalPreferences(): void {
  registerPreferenceTable({
    id: APPROVAL_LIST_TABLE_ID,
    labelI18nKey: 'approval.list.title',
    columnLabelKeys: {
      type: 'approval.field.type',
      requesterName: 'approval.field.requester',
      status: 'approval.field.status',
      createdAt: 'approval.field.createdAt',
      reviewerName: 'approval.field.reviewer',
      reviewedAt: 'approval.field.reviewedAt',
    },
    localeScope: APPROVAL_LOCALE_SCOPE,
  });
}
