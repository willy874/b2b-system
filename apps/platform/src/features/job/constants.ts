/* 狀態的清單、語系鍵與色調在 `@b2b-system/web-core/job`（兩個 app 共用）；這裡只有平台才有的。 */

import type { JobName, PlatformJobQueue } from '@/shared/api-sdk';

type JobScope = PlatformJobQueue['scope'];

export const JOB_SCOPE_LABEL_KEY = {
  tenant: 'job.scope.tenant',
  platform: 'job.scope.platform',
} as const satisfies Record<JobScope, string>;

/**
 * 每種工作的顯示名稱。`JobName` 是 api 已註冊的工作（OpenAPI 的 enum，docs/architecture/backend/10-jobs.md §6），
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
  'auth.platformTokenCleanup': 'job.name.platformTokenCleanup',
  'auth.tokenCleanup': 'job.name.tokenCleanup',
  'cdn.purge': 'job.name.cdnPurge',
  'dataTransfer.applyImport': 'job.name.dataTransferApplyImport',
  'dataTransfer.cleanup': 'job.name.dataTransferCleanup',
  'dataTransfer.export': 'job.name.dataTransferExport',
  'file.imageVariants': 'job.name.fileImageVariants',
  'file.maintenance': 'job.name.fileMaintenance',
  'gallery.maintenance': 'job.name.galleryMaintenance',
  'gallery.process': 'job.name.galleryProcess',
  'image.maintenance': 'job.name.imageMaintenance',
  'image.process': 'job.name.imageProcess',
  'jobs.outboxSweep': 'job.name.outboxSweep',
  'mfa.channelLinkCleanup': 'job.name.mfaChannelLinkCleanup',
  'mfa.cleanup': 'job.name.mfaCleanup',
  'mfa.emailCodeMail': 'job.name.mfaEmailCodeMail',
  'mfa.factorStats': 'job.name.mfaFactorStats',
  'mfa.lineCode': 'job.name.mfaLineCode',
  'mfa.platformCleanup': 'job.name.mfaPlatformCleanup',
  'mfa.platformEmailCodeMail': 'job.name.mfaPlatformEmailCodeMail',
  'mfa.platformLineCode': 'job.name.mfaPlatformLineCode',
  'mfa.platformSecurityNoticeMail': 'job.name.mfaPlatformSecurityNoticeMail',
  'mfa.platformSmsCode': 'job.name.mfaPlatformSmsCode',
  'mfa.platformTelegramCode': 'job.name.mfaPlatformTelegramCode',
  'mfa.securityNoticeMail': 'job.name.mfaSecurityNoticeMail',
  'mfa.smsCode': 'job.name.mfaSmsCode',
  'mfa.telegramCode': 'job.name.mfaTelegramCode',
  'notification.cleanup': 'job.name.notificationCleanup',
  'oidc.cleanup': 'job.name.oidcCleanup',
  'platformAdmin.accountMail': 'job.name.platformAdminAccountMail',
  'platformNotification.cleanup': 'job.name.platformNotificationCleanup',
  'rateLimit.cleanup': 'job.name.rateLimitCleanup',
  'revision.prune': 'job.name.revisionPrune',
  'storage.totalRollup': 'job.name.storageTotalRollup',
  'tenant.provision': 'job.name.tenantProvision',
  'tenant.provisionSweep': 'job.name.tenantProvisionSweep',
  'tenant.usageRollup': 'job.name.tenantUsageRollup',
  'trash.purge': 'job.name.trashPurge',
  'watch.notify': 'job.name.watchNotify',
  'webhook.cleanup': 'job.name.webhookCleanup',
  'webhook.deliver': 'job.name.webhookDeliver',
} as const satisfies Record<JobName, string>;

export function jobNameLabelKey(name: string): string | undefined {
  return Object.hasOwn(JOB_NAME_LABEL_KEY, name)
    ? JOB_NAME_LABEL_KEY[name as keyof typeof JOB_NAME_LABEL_KEY]
    : undefined;
}

/** 租戶篩選的保留值：只看平台層級（不屬於任何租戶）的工作；與後端 `GET /platform/jobs?tenant=platform` 一致。 */
export const PLATFORM_TENANT_FILTER = 'platform';
