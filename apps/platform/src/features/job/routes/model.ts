import { jobSearchShape } from '@b2b-system/web-core/job';
import { z } from 'zod/mini';

/** 背景工作列表的查詢條件：web-core/job 的共用欄位，加上租戶。 */
export const JobSearchQuerySchema = z.object({
  ...jobSearchShape,
  /** 租戶代碼，或 `platform`（`PLATFORM_TENANT_FILTER`）只看平台層級的工作 */
  tenant: z.catch(
    z.optional(z.string().check(z.trim(), z.toLowerCase(), z.minLength(1))),
    undefined,
  ),
});

export type JobSearchQuery = z.infer<typeof JobSearchQuerySchema>;

export { DEFAULT_JOB_SEARCH } from '@b2b-system/web-core/job';
