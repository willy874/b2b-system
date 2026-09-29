import type { JobSummary } from '@/shared/api-sdk';

export type JobState = JobSummary['state'];

export interface JobListParams {
  offset: number;
  limit: number;
  /** 佇列（工作名稱），例：`auditLog.archive` */
  name?: string;
  state?: JobState;
}
