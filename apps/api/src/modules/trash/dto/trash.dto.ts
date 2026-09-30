import { z } from 'zod';

import { PaginationSchema } from '@/core/http';
import { defineSchema } from '@/core/validation';

import { TRASH_RESOURCE_TYPES } from '../trash.constants';

export const TrashResourceTypeSchema = defineSchema(
  'TrashResourceType',
  z.enum(TRASH_RESOURCE_TYPES),
);

export const ListTrashSchema = PaginationSchema.extend({
  /** 一次只列一種類型（ADR-0025 D9：不跨類型合併分頁）。 */
  type: TrashResourceTypeSchema,
  keyword: z.string().trim().max(100).optional(),
});

export const TrashItemSchema = defineSchema(
  'TrashItem',
  z.object({
    id: z.string().uuid(),
    type: TrashResourceTypeSchema,
    /** 主要的名稱（使用者：顯示名稱）。 */
    name: z.string(),
    /** 次要的辨識資訊（使用者：email）。 */
    description: z.string().nullable(),
    deletedAt: z.string(),
    deletedBy: z.object({ id: z.string().uuid(), name: z.string() }).nullable(),
    /** 保留期限到了之後由 `trash.purge` 永久刪除的時間（依目前的 `trash.retentionDays`）。 */
    purgeAt: z.string(),
  }),
);

export type ListTrashDto = z.infer<typeof ListTrashSchema>;
export type TrashItemDto = z.infer<typeof TrashItemSchema>;
