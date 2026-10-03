import type { PlatformJobState } from '@/apis/platform-job/types';
import type { ChipTone } from '@/components/Chip';
import type { PlatformJobQueue } from '@/shared/api-sdk';

type JobScope = PlatformJobQueue['scope'];

/** 與後端 `JOB_STATES`（apps/api/src/core/jobs/job-store.ts）一致。 */
export const JOB_STATES = [
  'created',
  'retry',
  'active',
  'completed',
  'cancelled',
  'failed',
] as const satisfies readonly PlatformJobState[];

export const JOB_STATE_LABEL_KEY = {
  created: 'job.state.created',
  retry: 'job.state.retry',
  active: 'job.state.active',
  completed: 'job.state.completed',
  cancelled: 'job.state.cancelled',
  failed: 'job.state.failed',
} as const satisfies Record<PlatformJobState, string>;

/** 狀態以 Chip 的語意色調呈現（顏色由 design token 決定）。 */
export const JOB_STATE_TONE = {
  created: 'neutral',
  retry: 'warning',
  active: 'brand',
  completed: 'success',
  cancelled: 'neutral',
  failed: 'danger',
} as const satisfies Record<PlatformJobState, ChipTone>;

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
