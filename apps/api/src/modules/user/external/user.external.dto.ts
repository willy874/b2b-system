import { z } from 'zod';

import { PaginationSchema } from '@/core/http';
import { defineSchema } from '@/core/validation';

/**
 * 對外 API（`/v1`）的使用者契約（docs/architecture/06-external-api.md §9.2 D12、T3）：唯讀，給目錄同步。
 * 與內部的 `User` 分開：不含偏好（語系、時區）、登入與鎖定的細節、樂觀鎖版本。只列人，不含服務帳號。
 */
export const ExternalUserSchema = defineSchema(
  'ExternalUser',
  z.object({
    id: z.string().uuid(),
    email: z.string(),
    username: z.string().nullable(),
    displayName: z.string(),
    /** `locked`：登入失敗鎖定中或被鎖定。 */
    status: z.enum(['pending', 'active', 'inactive', 'locked']),
    roles: z.array(z.object({ id: z.string().uuid(), slug: z.string(), name: z.string() })),
    createdAt: z.string(),
    updatedAt: z.string(),
  }),
);

export const ExternalUserListSchema = defineSchema(
  'ExternalUserList',
  z.object({
    items: z.array(ExternalUserSchema),
    pagination: z.object({
      offset: z.number().int(),
      limit: z.number().int(),
      total: z.number().int(),
    }),
  }),
);

/** 依建立時間由新到舊；`offset` 最多 10000（要全部同步時以 `limit` 200 逐頁讀）。 */
export const ListExternalUserSchema = PaginationSchema.extend({
  /** email、username、顯示名稱的部分比對（不分大小寫）。 */
  keyword: z.string().trim().max(100).optional(),
  status: z.enum(['pending', 'active', 'inactive', 'locked']).optional(),
});

export type ExternalUserDto = z.infer<typeof ExternalUserSchema>;
export type ExternalUserListDto = z.infer<typeof ExternalUserListSchema>;
export type ListExternalUserDto = z.infer<typeof ListExternalUserSchema>;
