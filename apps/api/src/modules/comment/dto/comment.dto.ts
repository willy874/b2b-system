import { z } from 'zod';

import { ImageSourcesSchema } from '@/core/image';
import { defineSchema } from '@/core/validation';

import {
  COMMENT_BODY_MAX_LENGTH,
  COMMENT_MAX_MENTIONS,
  COMMENT_PAGE_DEFAULT,
  COMMENT_PAGE_MAX,
} from '../comment.constants';

/** 路徑上的資源類型：`core/resource` 的 `RESOURCE_TYPE`（camelCase）。 */
export const CommentResourceTypeSchema = z
  .string()
  .regex(/^[a-z][A-Za-z0-9]*$/)
  .max(50);

/** 留言裡出現的人（作者、被提及的人）。 */
export const CommentUserSchema = defineSchema(
  'CommentUser',
  z.object({ id: z.string().uuid(), displayName: z.string(), email: z.string() }),
);

export const CommentSchema = defineSchema(
  'Comment',
  z.object({
    id: z.string().uuid(),
    resourceType: z.string(),
    resourceId: z.string().uuid(),
    /** 純文字；`@顯示名稱` 只是文字，被提及的人另外列在 `mentions`（docs/architecture/backend/24-comment.md §8.2 D6）。 */
    body: z.string(),
    /** 作者已被永久刪除時為 null。 */
    author: CommentUserSchema.nullable(),
    /** 作者的頭像（docs/architecture/backend/25-image.md §15.8）；沒有設定、或作者已被永久刪除時為 null。 */
    authorAvatar: ImageSourcesSchema.nullable(),
    /** 被提及而且還在的人（被永久刪除的不列出）。 */
    mentions: z.array(CommentUserSchema),
    /** 樂觀鎖版本：`PATCH` 時帶上。 */
    version: z.number().int(),
    createdAt: z.string(),
    /** 最後一次編輯的時間；沒有編輯過為 null。 */
    editedAt: z.string().nullable(),
    /** 目前的使用者能不能編輯（只有作者）。 */
    canEdit: z.boolean(),
    /** 目前的使用者能不能刪除（作者，或持有 `comment:delete`）。 */
    canDelete: z.boolean(),
  }),
);

export const CommentPageSchema = defineSchema(
  'CommentPage',
  z.object({
    items: z.array(CommentSchema),
    /** 下一頁（較舊）的游標；沒有下一頁時為 null。 */
    nextCursor: z.string().nullable(),
  }),
);

/** `GET /comments/:resourceType/:resourceId`：新的在前，keyset 分頁（不計總數）。 */
export const ListCommentSchema = z.object({
  limit: z.coerce.number().int().min(1).max(COMMENT_PAGE_MAX).default(COMMENT_PAGE_DEFAULT),
  /** 上一頁回應的 `nextCursor`；不帶是第一頁（最新的）。 */
  cursor: z.string().trim().max(200).optional(),
});

const MentionIdsSchema = z
  .array(z.string().uuid())
  .max(COMMENT_MAX_MENTIONS)
  .refine((ids) => new Set(ids).size === ids.length, { message: 'duplicate mentionIds' })
  .default([]);

export const CreateCommentSchema = defineSchema(
  'CreateCommentRequest',
  z.object({
    body: z.string().trim().min(1).max(COMMENT_BODY_MAX_LENGTH),
    /** 被提及的人（由 `GET …/mentionable` 選出）；只通知看得到這個資源的人。 */
    mentionIds: MentionIdsSchema,
  }),
);

export const UpdateCommentSchema = defineSchema(
  'UpdateCommentRequest',
  z.object({
    body: z.string().trim().min(1).max(COMMENT_BODY_MAX_LENGTH),
    /** 整批取代；新加入的人才會收到提及的通知。 */
    mentionIds: MentionIdsSchema,
    /** 樂觀鎖：編輯開始時看到的 `version`（必填）。 */
    version: z.number().int().min(1),
  }),
);

/** `GET /comments/:resourceType/:resourceId/mentionable?q=`：依顯示名稱或 email 搜尋。 */
export const ListMentionableSchema = z.object({
  q: z.string().trim().max(100).default(''),
});

export const MentionableListSchema = defineSchema(
  'MentionableList',
  z.object({ items: z.array(CommentUserSchema) }),
);

export type CommentDto = z.infer<typeof CommentSchema>;
export type CommentUserDto = z.infer<typeof CommentUserSchema>;
export type CommentPageDto = z.infer<typeof CommentPageSchema>;
export type ListCommentDto = z.infer<typeof ListCommentSchema>;
export type CreateCommentDto = z.infer<typeof CreateCommentSchema>;
export type UpdateCommentDto = z.infer<typeof UpdateCommentSchema>;
export type ListMentionableDto = z.infer<typeof ListMentionableSchema>;
export type MentionableListDto = z.infer<typeof MentionableListSchema>;
