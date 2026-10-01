import { z } from 'zod';

import { PaginationSchema, SortSchema } from '@/core/http';
import { defineSchema } from '@/core/validation';
import { RoleSummarySchema } from '@/modules/user/dto/user.dto';

/** 服務帳號只有啟用與停用（沒有 pending、locked：它不登入）。 */
export const ServiceAccountStatusSchema = z.enum(['active', 'inactive']);

export const ServiceAccountSchema = defineSchema(
  'ServiceAccount',
  z.object({
    id: z.string().uuid(),
    name: z.string(),
    status: ServiceAccountStatusSchema,
    roles: z.array(RoleSummarySchema),
    /** 未撤銷、未過期、仍有效（`token_version` 沒變）的 token 數。 */
    activeTokenCount: z.number().int(),
    /** 樂觀鎖版本：`PATCH` 時帶上（ADR-0025 D3）。 */
    version: z.number().int(),
    createdAt: z.string(),
    updatedAt: z.string(),
  }),
);

export const ListServiceAccountSchema = PaginationSchema.extend({
  keyword: z.string().trim().max(100).optional(),
}).extend(SortSchema(['createdAt', 'name']).shape);

export const CreateServiceAccountSchema = defineSchema(
  'CreateServiceAccountRequest',
  z.object({
    name: z.string().trim().min(1).max(100),
    roleIds: z.array(z.string().uuid()).max(20).default([]),
  }),
);

export const UpdateServiceAccountSchema = defineSchema(
  'UpdateServiceAccountRequest',
  z
    .object({
      name: z.string().trim().min(1).max(100).optional(),
      /** 停用：它的 token 全部失效（`token_version` 遞增，D5）；再啟用也不會回來。 */
      status: ServiceAccountStatusSchema.optional(),
      /** 樂觀鎖：編輯開始時看到的 `version`（必填）。 */
      version: z.number().int().min(1),
    })
    .refine((dto) => dto.name !== undefined || dto.status !== undefined, {
      message: 'at least one field',
    }),
);

export const ReplaceServiceAccountRolesSchema = defineSchema(
  'ReplaceServiceAccountRolesRequest',
  z.object({
    roleIds: z.array(z.string().uuid()).max(20),
    /** 編輯開始時看到的角色；與目前不同（別人已改過）回 409 `SERVICE_ACCOUNT_ROLES_CONFLICT`。 */
    expectedRoleIds: z.array(z.string().uuid()).max(20),
  }),
);

export const ServiceAccountRolesSchema = defineSchema(
  'ServiceAccountRoles',
  z.object({ roles: z.array(RoleSummarySchema) }),
);

export type ServiceAccountDto = z.infer<typeof ServiceAccountSchema>;
export type ListServiceAccountDto = z.infer<typeof ListServiceAccountSchema>;
export type CreateServiceAccountDto = z.infer<typeof CreateServiceAccountSchema>;
export type UpdateServiceAccountDto = z.infer<typeof UpdateServiceAccountSchema>;
export type ReplaceServiceAccountRolesDto = z.infer<typeof ReplaceServiceAccountRolesSchema>;
