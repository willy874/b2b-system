/* 狀態的清單、語系鍵與色調在 `@b2b-system/web-core/job`（兩個 app 共用）。 */

/**
 * 已知工作的顯示名稱。後端新增工作而這裡還沒補時，畫面退回顯示工作名稱本身，
 * 所以不用 `satisfies Record<…>` 強制完整。
 */
export const JOB_NAME_LABEL_KEY: Readonly<Record<string, string>> = {
  'auditLog.archive': 'job.name.auditLogArchive',
  'file.maintenance': 'job.name.fileMaintenance',
  'auth.tokenCleanup': 'job.name.tokenCleanup',
};
