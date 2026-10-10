import { z } from 'zod';

import { defineSchema } from '@/core/validation';
import { TAG_COLORS } from '@/db/schema';

import { TAG_MAX_PER_RESOURCE, TAG_NAME_MAX_LENGTH } from '../tag.constants';

export const TagColorSchema = z.enum(TAG_COLORS);

const ScopeSchema = z
  .string()
  .trim()
  .regex(/^[a-z][A-Za-z0-9]*$/)
  .max(50);

/** 嵌在擁有者回應裡的標籤（檔案、資料夾、使用者的 `tags`，docs/architecture/backend/18-tag.md §7.2 D6）。 */
export const TagSummarySchema = defineSchema(
  'TagSummary',
  z.object({ id: z.string().uuid(), name: z.string(), color: TagColorSchema }),
);

export const TagSchema = defineSchema(
  'Tag',
  z.object({
    id: z.string().uuid(),
    scope: z.string(),
    name: z.string(),
    color: TagColorSchema,
    /** 樂觀鎖版本：`PATCH` 時帶上（docs/architecture/backend/14-revisions.md §9.2 D3）。 */
    version: z.number().int(),
    createdAt: z.string(),
    updatedAt: z.string(),
  }),
);

export const TagListSchema = defineSchema('TagList', z.object({ items: z.array(TagSchema) }));

export const ListTagSchema = z.object({ scope: ScopeSchema });

export const CreateTagSchema = defineSchema(
  'CreateTagRequest',
  z.object({
    scope: ScopeSchema,
    name: z.string().trim().min(1).max(TAG_NAME_MAX_LENGTH),
    color: TagColorSchema.default('neutral'),
  }),
);

export const UpdateTagSchema = defineSchema(
  'UpdateTagRequest',
  z
    .object({
      name: z.string().trim().min(1).max(TAG_NAME_MAX_LENGTH).optional(),
      color: TagColorSchema.optional(),
      /** 樂觀鎖：編輯開始時看到的 `version`（必填）。 */
      version: z.number().int().min(1),
    })
    .refine((dto) => dto.name !== undefined || dto.color !== undefined, {
      message: 'at least one field',
    }),
);

/** 整批取代一個資源的標籤（D7）；空陣列＝全部移除。 */
export const ReplaceResourceTagsSchema = defineSchema(
  'ReplaceResourceTagsRequest',
  z.object({
    tagIds: z
      .array(z.string().uuid())
      .max(TAG_MAX_PER_RESOURCE)
      .refine((ids) => new Set(ids).size === ids.length, { message: 'duplicate tagIds' }),
  }),
);

const TagIdListSchema = z
  .array(z.string().uuid())
  .max(TAG_MAX_PER_RESOURCE)
  .refine((ids) => new Set(ids).size === ids.length, { message: 'duplicate tagIds' });

/**
 * 差異語意：加上、拿掉幾個標籤，其他的不動（批次貼標籤用；不必先讀目前的標籤，和同時的編輯不會互相覆蓋）。
 * 已經有的再加、沒有的拿掉都不算錯，沒有變化時不寫稽核。
 */
export const UpdateResourceTagsSchema = defineSchema(
  'UpdateResourceTagsRequest',
  z
    .object({
      add: TagIdListSchema.default([]),
      remove: TagIdListSchema.default([]),
    })
    .refine((dto) => dto.add.length + dto.remove.length > 0, { message: 'nothing to change' })
    .refine((dto) => !dto.add.some((id) => dto.remove.includes(id)), {
      message: 'tagId in both add and remove',
    }),
);

export const ResourceTagsSchema = defineSchema(
  'ResourceTags',
  z.object({ tags: z.array(TagSummarySchema) }),
);

/**
 * 列表篩選的 `tagId`（任一符合，D6）：查詢字串可重複（`tagId=a&tagId=b`，與使用者列表的 `roleId` 同一種寫法）。
 * 擁有者的 list DTO 以 `.extend({ tagId: TagIdsFilterSchema })` 使用。
 */
export const TagIdsFilterSchema = z
  .preprocess(
    (value) => (value === undefined || Array.isArray(value) ? value : [value]),
    z.array(z.string().uuid()).min(1).max(TAG_MAX_PER_RESOURCE),
  )
  .optional();

export type TagDto = z.infer<typeof TagSchema>;
export type TagSummaryDto = z.infer<typeof TagSummarySchema>;
export type TagListDto = z.infer<typeof TagListSchema>;
export type ListTagDto = z.infer<typeof ListTagSchema>;
export type CreateTagDto = z.infer<typeof CreateTagSchema>;
export type UpdateTagDto = z.infer<typeof UpdateTagSchema>;
export type ReplaceResourceTagsDto = z.infer<typeof ReplaceResourceTagsSchema>;
export type UpdateResourceTagsDto = z.infer<typeof UpdateResourceTagsSchema>;
export type ResourceTagsDto = z.infer<typeof ResourceTagsSchema>;
