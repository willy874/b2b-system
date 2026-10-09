import { z } from 'zod';

import { defineSchema } from '@/core/validation';

import { GrantLevelSchema } from './file-folder-grant.dto';

const CommentSchema = z.string().trim().max(500);

/** 申請資料夾存取（docs/architecture/iam/06-resource-grants.md §6.5）。 */
export const CreateFileAccessRequestSchema = defineSchema(
  'CreateFileAccessRequest',
  z.object({
    level: GrantLevelSchema,
    reason: CommentSchema.optional(),
    /** 駁回或撤回後重新送出時，前一筆申請的 id（docs/architecture/backend/20-approval.md §9.9）。 */
    resubmittedFrom: z.string().uuid().optional(),
  }),
);

export const FileAccessRequestSubmittedSchema = defineSchema(
  'FileAccessRequestSubmitted',
  z.object({
    /** true：已建立；false：已有一筆待審，沒有另建。 */
    submitted: z.boolean(),
  }),
);

export const FileAccessRequestSchema = defineSchema(
  'FileAccessRequest',
  z.object({
    id: z.string().uuid(),
    requesterId: z.string().uuid().nullable(),
    requesterName: z.string(),
    level: GrantLevelSchema,
    reason: z.string().nullable(),
    createdAt: z.string(),
  }),
);

export const FileAccessRequestListSchema = defineSchema(
  'FileAccessRequestList',
  z.object({ items: z.array(FileAccessRequestSchema) }),
);

export const ReviewFileAccessRequestSchema = defineSchema(
  'ReviewFileAccessRequest',
  z.object({ comment: CommentSchema.optional() }),
);

export type CreateFileAccessRequestDto = z.infer<typeof CreateFileAccessRequestSchema>;
export type FileAccessRequestDto = z.infer<typeof FileAccessRequestSchema>;
export type FileAccessRequestListDto = z.infer<typeof FileAccessRequestListSchema>;
export type ReviewFileAccessRequestDto = z.infer<typeof ReviewFileAccessRequestSchema>;
