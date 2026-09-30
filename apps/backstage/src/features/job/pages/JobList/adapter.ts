import type { JobState } from '@/apis/job/types';
import type { ChipTone } from '@/components/Chip';
import type { Job, JobQueue, JobSummary } from '@/shared/api-sdk';

import { JOB_NAME_LABEL_KEY, JOB_STATE_LABEL_KEY, JOB_STATE_TONE } from '../../constants';

export interface JobQueueVM {
  name: string;
  /** 已知工作的顯示名稱；沒有就顯示 `name` 本身 */
  labelKey: string | undefined;
  cron: string | null;
  readyCount: number;
  deferredCount: number;
  activeCount: number;
  failedCount: number;
  completedCount: number;
}

export interface JobRowVM {
  id: string;
  name: string;
  labelKey: string | undefined;
  state: JobState;
  stateLabelKey: (typeof JOB_STATE_LABEL_KEY)[JobState];
  stateTone: ChipTone;
  /** 已重試次數 / 上限 */
  retryCount: number;
  retryLimit: number;
  createdAt: Date;
  /** 排定在未來才執行（延後入列、重試退避中） */
  scheduledAt: Date | null;
  completedAt: Date | null;
  /** 只有 `failed` 且持有 `job:retry` 才能重試 */
  canRetry: boolean;
}

export interface JobDetailVM {
  /** 失敗時的錯誤訊息（`output.message`）；成功或沒有訊息時是 `null` */
  errorMessage: string | null;
  data: Record<string, unknown>;
  output: Record<string, unknown> | null;
}

/** 已經結束、之後不會再變的狀態。 */
export function isFinalJobState(state: JobState): boolean {
  return state === 'completed' || state === 'cancelled' || state === 'failed';
}

export function toJobQueueVM(dto: JobQueue): JobQueueVM {
  return {
    name: dto.name,
    labelKey: JOB_NAME_LABEL_KEY[dto.name],
    cron: dto.cron,
    readyCount: dto.readyCount,
    deferredCount: dto.deferredCount,
    activeCount: dto.activeCount,
    failedCount: dto.failedCount,
    completedCount: dto.completedCount,
  };
}

/** adapter 是後端契約變動的緩衝層：欄位改名時只有這裡要改。 */
export function toJobRowVM(
  dto: JobSummary,
  capabilities: { canRetry: boolean },
  now: Date = new Date(),
): JobRowVM {
  const startAfter = new Date(dto.startAfter);
  const isWaiting = dto.state === 'created' || dto.state === 'retry';
  return {
    id: dto.id,
    name: dto.name,
    labelKey: JOB_NAME_LABEL_KEY[dto.name],
    state: dto.state,
    stateLabelKey: JOB_STATE_LABEL_KEY[dto.state],
    stateTone: JOB_STATE_TONE[dto.state],
    retryCount: dto.retryCount,
    retryLimit: dto.retryLimit,
    createdAt: new Date(dto.createdOn),
    scheduledAt: isWaiting && startAfter > now ? startAfter : null,
    completedAt: dto.completedOn ? new Date(dto.completedOn) : null,
    canRetry: capabilities.canRetry && dto.state === 'failed',
  };
}

export function toJobDetailVM(dto: Job): JobDetailVM {
  const message = dto.state === 'failed' ? dto.output?.message : undefined;
  return {
    errorMessage: typeof message === 'string' ? message : null,
    data: dto.data ?? {},
    output: dto.output,
  };
}
