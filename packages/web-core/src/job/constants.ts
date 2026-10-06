import type { ChipTone } from '@b2b-system/ui/Chip';

/**
 * 背景工作的狀態，與後端 `JOB_STATES`（apps/api/src/core/jobs/job-store.ts）一致。
 * app 的 adapter 把 api-sdk 的狀態指定給 `JobState`：後端新增狀態而這裡沒跟上時編譯失敗。
 */
export const JOB_STATES = [
  'created',
  'retry',
  'active',
  'completed',
  'cancelled',
  'failed',
] as const;
export type JobState = (typeof JOB_STATES)[number];

export const JOB_STATE_LABEL_KEY = {
  created: 'job.state.created',
  retry: 'job.state.retry',
  active: 'job.state.active',
  completed: 'job.state.completed',
  cancelled: 'job.state.cancelled',
  failed: 'job.state.failed',
} as const satisfies Record<JobState, string>;

/** 狀態以 Chip 的語意色調呈現（顏色由 design token 決定）。 */
export const JOB_STATE_TONE = {
  created: 'neutral',
  retry: 'warning',
  active: 'brand',
  completed: 'success',
  cancelled: 'neutral',
  failed: 'danger',
} as const satisfies Record<JobState, ChipTone>;

/** 已經結束、之後不會再變的狀態。 */
export function isFinalJobState(state: JobState): boolean {
  return state === 'completed' || state === 'cancelled' || state === 'failed';
}
