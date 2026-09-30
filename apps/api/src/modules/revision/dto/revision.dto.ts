import { z } from 'zod';

import { PaginationSchema } from '@/core/http';
import { defineSchema } from '@/core/validation';

/** `GET /<resource>/:id/revisions` 的查詢：一般的分頁，版本新的在前。 */
export const ListRevisionSchema = PaginationSchema;

/** 路徑上的版本號。 */
export const RevisionVersionSchema = z.coerce.number().int().min(1).max(2_147_483_647);

/** 版本列表的一列（各資源共用；快照另外以單版端點取得）。 */
export const RevisionSummarySchema = defineSchema(
  'RevisionSummary',
  z.object({
    /** 這個資源自己的流水號（1, 2, 3…），與實體的樂觀鎖 `version` 無關。 */
    version: z.number().int(),
    createdAt: z.string(),
    /** 寫入這一版的人；系統（基準版本、排程）或那個人已被永久刪除時為 null。 */
    actor: z.object({ id: z.string().uuid(), name: z.string() }).nullable(),
    /** 快照超過單版上限而未保存（ADR-0025 D1）：看不到內容、不能還原。 */
    tooLarge: z.boolean(),
  }),
);

export type ListRevisionDto = z.infer<typeof ListRevisionSchema>;
export type RevisionSummaryDto = z.infer<typeof RevisionSummarySchema>;
