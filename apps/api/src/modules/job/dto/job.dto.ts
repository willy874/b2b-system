import { z } from 'zod';

import { OffsetSchema } from '@/core/http';
import { JOB_STATES } from '@/core/jobs';
import { defineSchema } from '@/core/validation';

export const ListJobSchema = z.object({
  offset: OffsetSchema,
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

/**
 * 平台的背景工作監控（apps/auth，docs/adr/0020-physical-tenant-isolation.md D23）：看得到所有租戶與平台自己的工作。
 * `tenant`：租戶代碼只看那個租戶；`platform`（保留字，不會是租戶代碼）只看平台工作；不給就是全部。
 */
export const ListPlatformJobSchema = ListJobSchema.extend({
  tenant: z.string().trim().toLowerCase().max(63).optional(),
});

export type ListPlatformJobDto = z.infer<typeof ListPlatformJobSchema>;

/** 工作屬於哪個租戶：平台工作兩者都是 null；租戶已刪除時只有 id。 */
const JobOwnerShape = z.object({
  tenantId: z.string().nullable(),
  tenantCode: z.string().nullable(),
});

export const PlatformJobQueueSchema = defineSchema(
  'PlatformJobQueue',
  JobQueueSchema.extend({ scope: z.enum(['tenant', 'platform']) }),
);

export const PlatformJobQueueListSchema = defineSchema(
  'PlatformJobQueueList',
  z.object({ items: z.array(PlatformJobQueueSchema) }),
);

export const PlatformJobSummarySchema = defineSchema(
  'PlatformJobSummary',
  JobSummaryShape.merge(JobOwnerShape),
);

export const PlatformJobSchema = defineSchema(
  'PlatformJob',
  JobSummaryShape.merge(JobOwnerShape).extend({
    data: z.record(z.string(), z.unknown()).nullable(),
    output: z.record(z.string(), z.unknown()).nullable(),
  }),
);

export type PlatformJobQueueListDto = z.infer<typeof PlatformJobQueueListSchema>;
export type PlatformJobSummaryDto = z.infer<typeof PlatformJobSummarySchema>;
export type PlatformJobDto = z.infer<typeof PlatformJobSchema>;
