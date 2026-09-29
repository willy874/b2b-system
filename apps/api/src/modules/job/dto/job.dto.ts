import { z } from 'zod';

import { JOB_STATES } from '@/core/jobs';
import { defineSchema } from '@/core/validation';

export const ListJobSchema = z.object({
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  name: z.string().trim().max(100).optional(),
  state: z.enum(JOB_STATES).optional(),
});

export type ListJobDto = z.infer<typeof ListJobSchema>;

export const JobQueueSchema = defineSchema(
  'JobQueue',
  z.object({
    name: z.string(),
    /** 排程（cron，UTC）；`null` 代表只由程式入列。 */
    cron: z.string().nullable(),
    /** 可以立即執行、正在等 worker 的筆數。 */
    readyCount: z.number().int(),
    /** 排定在未來（含重試退避中）的筆數。 */
    deferredCount: z.number().int(),
    activeCount: z.number().int(),
    /** 保留期內失敗（重試用完）的筆數。 */
    failedCount: z.number().int(),
    /** 保留期內完成的筆數（完成的工作保留 7 天）。 */
    completedCount: z.number().int(),
  }),
);

export type JobQueueDto = z.infer<typeof JobQueueSchema>;

export const JobQueueListSchema = defineSchema(
  'JobQueueList',
  z.object({ items: z.array(JobQueueSchema) }),
);

export type JobQueueListDto = z.infer<typeof JobQueueListSchema>;

/** 列表只回摘要；`data` / `output` 可能很大，展開明細時才由 `GET /jobs/:id` 取。 */
const JobSummaryShape = z.object({
  id: z.string(),
  name: z.string(),
  state: z.enum(JOB_STATES),
  retryCount: z.number().int(),
  retryLimit: z.number().int(),
  createdOn: z.string(),
  startAfter: z.string(),
  startedOn: z.string().nullable(),
  completedOn: z.string().nullable(),
});

export const JobSummarySchema = defineSchema('JobSummary', JobSummaryShape);

export type JobSummaryDto = z.infer<typeof JobSummarySchema>;

export const JobSchema = defineSchema(
  'Job',
  JobSummaryShape.extend({
    data: z.record(z.string(), z.unknown()).nullable(),
    /** 完成時是 handler 的回傳值；失敗時是錯誤（`message`、`stack`…）。 */
    output: z.record(z.string(), z.unknown()).nullable(),
  }),
);

export type JobDto = z.infer<typeof JobSchema>;
