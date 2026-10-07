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

/** 工作在背景持續變化：列表與佇列概況每 10 秒重新整理一次，不必手動重新載入。 */
export const JOB_REFRESH_INTERVAL_MS = 10_000;

/** 背景工作頁的分頁：工作列表、佇列概況。app 放在網址的 `view`，預設 `list`。 */
export const JOB_VIEWS = ['list', 'queues'] as const;
export type JobView = (typeof JOB_VIEWS)[number];

/** 列表的每頁筆數選項（兩個 app 相同）。 */
export const JOB_PAGE_SIZE_OPTIONS = [25, 50, 100];
