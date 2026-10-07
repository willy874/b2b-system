import type { JobQueueVM, JobRowVM } from '../types';

export const ROW: JobRowVM = {
  id: 'j1',
  name: 'file.maintenance',
  labelKey: undefined,
  state: 'failed',
  stateLabelKey: 'job.state.failed',
  stateTone: 'danger',
  retryCount: 2,
  retryLimit: 2,
  createdAt: new Date('2026-09-29T10:00:00.000Z'),
  scheduledAt: null,
  completedAt: new Date('2026-09-29T10:00:02.000Z'),
  canRetry: true,
};

export const QUEUE: JobQueueVM = {
  name: 'file.maintenance',
  labelKey: undefined,
  cron: '0 3 * * *',
  readyCount: 0,
  deferredCount: 1,
  activeCount: 0,
  failedCount: 2,
  completedCount: 12,
};
