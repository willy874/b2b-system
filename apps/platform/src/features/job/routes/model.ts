import { JOB_STATES } from '@b2b-system/web-core/job';
import { z } from 'zod';

export const JobSearchQuerySchema = z.object({
  offset: z.coerce.number().int().min(0).catch(0),
  limit: z.coerce.number().int().min(1).max(100).catch(50),
  name: z.string().trim().min(1).optional().catch(undefined),
  state: z.enum(JOB_STATES).optional().catch(undefined),
  /** 租戶代碼，或 `platform`（`PLATFORM_TENANT_FILTER`）只看平台層級的工作 */
  tenant: z.string().trim().toLowerCase().min(1).optional().catch(undefined),
});

export type JobSearchQuery = z.infer<typeof JobSearchQuerySchema>;

/** 預設的查詢條件；與它相等的參數不寫進網址（`stripSearchParams`，見 routes/pages.ts）。 */
export const DEFAULT_JOB_SEARCH: JobSearchQuery = {
  offset: 0,
  limit: 50,
};
