/* 狀態的清單、語系鍵與色調在 `@b2b-system/web-core/job`（兩個 app 共用）；這裡只有平台才有的。 */

import type { PlatformJobQueue } from '@/shared/api-sdk';

type JobScope = PlatformJobQueue['scope'];

export const JOB_SCOPE_LABEL_KEY = {
  tenant: 'job.scope.tenant',
  platform: 'job.scope.platform',
} as const satisfies Record<JobScope, string>;

/**
 * 已知工作的顯示名稱。後端新增工作而這裡還沒補時，畫面退回顯示工作名稱本身，
 * 所以不用 `satisfies Record<…>` 強制完整。
 */
export const JOB_NAME_LABEL_KEY: Readonly<Record<string, string>> = {
  'auditLog.archive': 'job.name.auditLogArchive',
  'file.maintenance': 'job.name.fileMaintenance',
  'approval.resultMail': 'job.name.approvalResultMail',
  'auth.activationMail': 'job.name.activationMail',
  'auth.passwordResetMail': 'job.name.passwordResetMail',
  'platformAdmin.accountMail': 'job.name.platformAdminAccountMail',
  'tenant.provision': 'job.name.tenantProvision',
  'tenant.provisionSweep': 'job.name.tenantProvisionSweep',
  'oidc.cleanup': 'job.name.oidcCleanup',
  'auth.tokenCleanup': 'job.name.tokenCleanup',
  'auth.platformTokenCleanup': 'job.name.platformTokenCleanup',
  'jobs.outboxSweep': 'job.name.outboxSweep',
};

/** 租戶篩選的保留值：只看平台層級（不屬於任何租戶）的工作；與後端 `GET /platform/jobs?tenant=platform` 一致。 */
export const PLATFORM_TENANT_FILTER = 'platform';
