import { z } from 'zod';

import { PaginationSchema, QueryArraySchema, SortSchema } from '@/core/http';
import { TagIdsFilterSchema } from '@/modules/tag/dto/tag.dto';

export const ListUserSchema = PaginationSchema.extend({
  keyword: z.string().trim().max(100).optional(),
  status: QueryArraySchema(z.enum(['pending', 'active', 'inactive', 'locked'])),
  roleId: QueryArraySchema(z.string().uuid()),
  /**
   * `roleId` 也算經由群組（含巢狀）持有的人；預設只看直接持有。MFA 政策頁「不符合政策的人」的名單用它，
   * 與人數同一個判斷（docs/architecture/backend/21-mfa.md §6）。
   */
  includeGroupRoles: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
  /** 有沒有設定 MFA（docs/architecture/backend/21-mfa.md §6：找出不符合政策的人）。 */
  mfa: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
  /** 貼了其中任一個標籤（docs/architecture/backend/18-tag.md §7.2 D6）。 */
  tagId: TagIdsFilterSchema,
  /**
   * 屬於這個部門（docs/architecture/backend/23-organization.md §4）；`organization` 未啟用時回 `VALIDATION_FAILED`。
   * `includeDescendants=true` 時含下層部門。
   */
  orgUnitId: z.string().uuid().optional(),
  includeDescendants: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
}).extend(SortSchema(['createdAt', 'email', 'displayName', 'lastLoginAt']).shape);

export type ListUserDto = z.infer<typeof ListUserSchema>;
