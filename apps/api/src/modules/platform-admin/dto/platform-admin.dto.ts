import { z } from 'zod';

import { OffsetSchema } from '@/core/http';
import { defineSchema } from '@/core/validation';
import {
  AUDIT_LOG_MAX_RANGE_DAYS,
  AUDIT_LOG_MAX_RANGE_MS,
} from '@/modules/audit-log/audit-log.constants';

export const PlatformAdminRoleSchema = z.enum(['super-admin', 'operator', 'auditor']);

/** 平台管理者（docs/architecture/05-tenancy.md §10.2 D5）；不含密碼與登入失敗計數。 */
export const PlatformAdminSchema = defineSchema(
  'PlatformAdmin',
  z.object({
    id: z.string().uuid(),
    email: z.string(),
    displayName: z.string(),
    role: PlatformAdminRoleSchema,
    status: z.enum(['active', 'inactive', 'locked', 'pending']),
    lastLoginAt: z.string().nullable(),
    /** 有任一已設定的 MFA 驗證方式（docs/architecture/backend/21-mfa.md §8）。 */
    mfaEnabled: z.boolean(),
    createdAt: z.string(),
  }),
);

export const PlatformAdminListSchema = defineSchema(
  'PlatformAdminList',
  z.object({ items: z.array(PlatformAdminSchema) }),
);

/** 新增平台管理者：建立成 `pending`，寄啟用信讓本人設定密碼（不接受密碼）。 */
export const CreatePlatformAdminSchema = defineSchema(
  'CreatePlatformAdminRequest',
  z.object({
    email: z.string().trim().toLowerCase().email().max(254),
    displayName: z.string().trim().min(1).max(100),
    role: PlatformAdminRoleSchema,
  }),
);

/** 改名、換角色、停用／啟用（`locked` 改回 `active` 即解鎖）。 */
export const UpdatePlatformAdminSchema = defineSchema(
  'UpdatePlatformAdminRequest',
  z
    .object({
      displayName: z.string().trim().min(1).max(100).optional(),
      role: PlatformAdminRoleSchema.optional(),
      status: z.enum(['active', 'inactive']).optional(),
    })
    .refine((dto) => Object.values(dto).some((value) => value !== undefined), 'empty'),
);

/** 寄出的是哪一種連結：還沒啟用的是啟用信，其他人是重設密碼信。 */
export const PlatformAdminPasswordLinkSchema = defineSchema(
  'PlatformAdminPasswordLink',
  z.object({ purpose: z.enum(['activation', 'passwordReset']) }),
);

export const ListPlatformAuditLogSchema = z
  .object({
    offset: OffsetSchema,
    limit: z.coerce.number().int().min(1).max(100).default(50),
    /** 支援前綴比對：`tenant.*` */
    action: z.string().trim().max(100).optional(),
    actorEmail: z.string().trim().max(254).optional(),
    resourceId: z.string().trim().max(100).optional(),
    result: z.enum(['success', 'failure']).optional(),
    // 沒帶時由 service 補成「現在往前 90 天」
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
  })
  .superRefine(({ from, to }, ctx) => {
    if (!from || !to) return;
    if (from > to) {
      ctx.addIssue({ code: 'custom', path: ['from'], message: 'must be before `to`' });
    } else if (to.getTime() - from.getTime() > AUDIT_LOG_MAX_RANGE_MS) {
      ctx.addIssue({
        code: 'custom',
        path: ['from'],
        message: `range must not exceed ${AUDIT_LOG_MAX_RANGE_DAYS} days`,
      });
    }
  });

/** 平台稽核（D19）：平台管理者做過的事。筆數少、欄位小，列表直接帶 `metadata`。 */
export const PlatformAuditLogSchema = defineSchema(
  'PlatformAuditLog',
  z.object({
    id: z.string(),
    occurredAt: z.string(),
    actorId: z.string().nullable(),
    actorEmail: z.string(),
    action: z.string(),
    resourceType: z.string(),
    resourceId: z.string().nullable(),
    result: z.enum(['success', 'failure']),
    errorCode: z.string().nullable(),
    metadata: z.record(z.string(), z.unknown()).nullable(),
  }),
);

export type PlatformAdminDto = z.infer<typeof PlatformAdminSchema>;
export type PlatformAdminListDto = z.infer<typeof PlatformAdminListSchema>;
export type CreatePlatformAdminDto = z.infer<typeof CreatePlatformAdminSchema>;
export type UpdatePlatformAdminDto = z.infer<typeof UpdatePlatformAdminSchema>;
export type PlatformAdminPasswordLinkDto = z.infer<typeof PlatformAdminPasswordLinkSchema>;
export type ListPlatformAuditLogDto = z.infer<typeof ListPlatformAuditLogSchema>;
export type PlatformAuditLogDto = z.infer<typeof PlatformAuditLogSchema>;
