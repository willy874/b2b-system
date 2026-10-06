import { JOB_STATE_LABEL_KEY, JOB_STATE_TONE } from '@b2b-system/web-core/job';
import type { JobDetailVM, JobQueueVM, JobRowVM } from '@b2b-system/web-core/job';

import type { Job, JobQueue, JobSummary } from '@/shared/api-sdk';

import { JOB_NAME_LABEL_KEY } from '../../constants';

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
