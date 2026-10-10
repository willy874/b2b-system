import { jobSearchShape } from '@b2b-system/web-core/job';
import { z } from 'zod/mini';

/** 背景工作列表的查詢條件（欄位在 web-core/job，與 apps/platform 共用）。 */
export const JobSearchQuerySchema = z.object(jobSearchShape);

export type JobSearchQuery = z.infer<typeof JobSearchQuerySchema>;

export { DEFAULT_JOB_SEARCH } from '@b2b-system/web-core/job';
