import type { JobState } from '@/apis/job/types';
import type { ChipTone } from '@/components/Chip';

/** 與後端 `JOB_STATES`（apps/api/src/core/jobs/job-store.ts）一致。 */
export const JOB_STATES = [
  'created',
  'retry',
  'active',
  'completed',
  'cancelled',
  'failed',
] as const satisfies readonly JobState[];

export const JOB_STATE_LABEL_KEY = {
  created: 'job.state.created',
  retry: 'job.state.retry',
  active: 'job.state.active',
  completed: 'job.state.completed',
  cancelled: 'job.state.cancelled',
  failed: 'job.state.failed',
} as const satisfies Record<JobState, string>;

export const JOB_STATE_TONE = {
  created: 'neutral',
  retry: 'warning',
  active: 'brand',
  completed: 'success',
  cancelled: 'neutral',
  failed: 'danger',
} as const satisfies Record<JobState, ChipTone>;

/**
 * 已知工作的顯示名稱。後端新增工作而這裡還沒補時，畫面退回顯示工作名稱本身，
 * 所以不用 `satisfies Record<…>` 強制完整。
 */
export const JOB_NAME_LABEL_KEY: Readonly<Record<string, string>> = {
  'auditLog.archive': 'job.name.auditLogArchive',
  'file.maintenance': 'job.name.fileMaintenance',
  'auth.tokenCleanup': 'job.name.tokenCleanup',
};
