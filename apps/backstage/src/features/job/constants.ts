/* 狀態的清單、語系鍵與色調在 `@b2b-system/web-core/job`（兩個 app 共用）。 */

import type { TenantJobName } from '@/shared/api-sdk';

/**
 * 每種工作的顯示名稱。`TenantJobName` 是 api 已註冊的工作（OpenAPI 的 enum，docs/architecture/backend/10-jobs.md §6），
 * 後端新增工作而這裡沒跟上時編譯失敗；執行期遇到不認得的名稱（前端比後端舊）由 `jobNameLabelKey()` 退回顯示名稱本身。
 */
export const JOB_NAME_LABEL_KEY = {
  'announcement.dispatch': 'job.name.announcementDispatch',
  'announcement.eventDispatch': 'job.name.announcementEventDispatch',
  'announcement.fanOut': 'job.name.announcementFanOut',
  'announcement.maintenance': 'job.name.announcementMaintenance',
  'approval.resultMail': 'job.name.approvalResultMail',
  'auditLog.archive': 'job.name.auditLogArchive',
  'auth.activationMail': 'job.name.activationMail',
  'auth.passwordResetMail': 'job.name.passwordResetMail',
  'auth.tokenCleanup': 'job.name.tokenCleanup',
  'dataTransfer.applyImport': 'job.name.dataTransferApplyImport',
  'dataTransfer.cleanup': 'job.name.dataTransferCleanup',
  'dataTransfer.export': 'job.name.dataTransferExport',
  'file.imageVariants': 'job.name.fileImageVariants',
  'file.maintenance': 'job.name.fileMaintenance',
  'gallery.maintenance': 'job.name.galleryMaintenance',
  'gallery.process': 'job.name.galleryProcess',
  'image.maintenance': 'job.name.imageMaintenance',
  'image.process': 'job.name.imageProcess',
  'mfa.cleanup': 'job.name.mfaCleanup',
  'mfa.emailCodeMail': 'job.name.mfaEmailCodeMail',
  'mfa.lineCode': 'job.name.mfaLineCode',
  'mfa.securityNoticeMail': 'job.name.mfaSecurityNoticeMail',
  'mfa.smsCode': 'job.name.mfaSmsCode',
  'mfa.telegramCode': 'job.name.mfaTelegramCode',
  'notification.cleanup': 'job.name.notificationCleanup',
  'revision.prune': 'job.name.revisionPrune',
  'trash.purge': 'job.name.trashPurge',
  'watch.notify': 'job.name.watchNotify',
  'webhook.cleanup': 'job.name.webhookCleanup',
  'webhook.deliver': 'job.name.webhookDeliver',
} as const satisfies Record<TenantJobName, string>;

export function jobNameLabelKey(name: string): string | undefined {
  return Object.hasOwn(JOB_NAME_LABEL_KEY, name)
    ? JOB_NAME_LABEL_KEY[name as keyof typeof JOB_NAME_LABEL_KEY]
    : undefined;
}
