import { z } from 'zod';

import { PaginationSchema, SortSchema } from '@/core/http';
import { defineSchema, uniqueItems } from '@/core/validation';

import { APPROVAL_STATUSES, APPROVAL_TYPES } from '../approval.constants';

export const ApprovalStatusSchema = defineSchema('ApprovalStatus', z.enum(APPROVAL_STATUSES));

export const ApprovalTypeSchema = defineSchema('ApprovalType', z.enum(APPROVAL_TYPES));

export const ApprovalRequestSchema = defineSchema(
  'ApprovalRequest',
  z.object({
    id: z.string().uuid(),
    type: ApprovalTypeSchema,
    status: ApprovalStatusSchema,
    /** 依類型而定（`user.register` = `{ email, displayName }`）；不含 `private_payload`。 */
    payload: z.record(z.string(), z.unknown()),
    requesterId: z.string().uuid().nullable(),
    requesterName: z.string(),
    reason: z.string().nullable(),
    reviewerId: z.string().uuid().nullable(),
    reviewerName: z.string().nullable(),
    reviewComment: z.string().nullable(),
    reviewedAt: z.string().nullable(),
    resultResourceId: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  }),
);

/** 重複 key 的查詢參數（`?status=a&status=b`）在 express 會是陣列。 */
const multiValue = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((value) => {
    if (value === undefined) return undefined;
    return Array.isArray(value) ? value : [value];
  }, z.array(schema).optional());

export const ListApprovalSchema = PaginationSchema.extend({
  /** 申請人名稱（註冊 = email）的部分比對。 */
  keyword: z.string().trim().max(100).optional(),
  status: multiValue(z.enum(APPROVAL_STATUSES)),
  type: multiValue(z.enum(APPROVAL_TYPES)),
}).extend(SortSchema(['createdAt', 'reviewedAt']).shape);

const CommentSchema = z.string().trim().max(500);

export const ApproveApprovalSchema = defineSchema(
  'ApproveApprovalRequest',
  z.object({
    comment: CommentSchema.optional(),
    /** `user.register`：核准時一併指派的角色（受反提權限制）；其他類型忽略。 */
    roleIds: uniqueItems(z.array(z.string().uuid()).max(20)).default([]),
  }),
);

export const RejectApprovalSchema = defineSchema(
  'RejectApprovalRequest',
  z.object({ comment: CommentSchema.optional() }),
);

export type ApprovalRequestDto = z.infer<typeof ApprovalRequestSchema>;
export type ListApprovalDto = z.infer<typeof ListApprovalSchema>;
export type ApproveApprovalDto = z.infer<typeof ApproveApprovalSchema>;
export type RejectApprovalDto = z.infer<typeof RejectApprovalSchema>;
