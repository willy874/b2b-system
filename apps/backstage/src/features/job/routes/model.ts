import { JOB_STATES } from '@b2b-system/web-core/job';
import { z } from 'zod';

export const JobSearchQuerySchema = z.object({
  offset: z.coerce.number().int().min(0).catch(0),
  limit: z.coerce.number().int().min(1).max(100).catch(50),
  /** 其中任一種工作；網址上重複的 `name` 成為陣列（`web-core/router/search.ts`）。 */
  name: z
    .union([z.string().trim().min(1), z.array(z.string().trim().min(1)).min(1)])
    .transform((value) => (Array.isArray(value) ? value : [value]))
    .optional()
    .catch(undefined),
  /** 其中任一種狀態。 */
  state: z
    .union([z.enum(JOB_STATES), z.array(z.enum(JOB_STATES)).min(1)])
    .transform((value) => (Array.isArray(value) ? value : [value]))
    .optional()
    .catch(undefined),
});

export type JobSearchQuery = z.infer<typeof JobSearchQuerySchema>;

/** 預設的查詢條件；與它相等的參數不寫進網址（`stripSearchParams`，見 routes/pages.ts）。 */
export const DEFAULT_JOB_SEARCH: JobSearchQuery = {
  offset: 0,
  limit: 50,
};
