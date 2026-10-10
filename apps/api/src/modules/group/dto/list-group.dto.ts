import { z } from 'zod';

import { PaginationSchema, SortSchema } from '@/core/http';

export const ListGroupSchema = PaginationSchema.extend({
  keyword: z.string().trim().max(100).optional(),
  /** 這位使用者所在的群組：直接所屬，以及經由巢狀群組所屬的（每一列帶 `membership`）。 */
  userId: z.string().uuid().optional(),
  /** 持有這個角色的群組。 */
  roleId: z.string().uuid().optional(),
}).extend(SortSchema(['createdAt', 'name', 'memberCount', 'roleCount']).shape);

export type ListGroupDto = z.infer<typeof ListGroupSchema>;

export const ListGroupMembersSchema = PaginationSchema.extend({
  /** 成員的名稱或 email（群組只比對名稱）；分頁的 `total` 是過濾後的數量。 */
  keyword: z.string().trim().max(100).optional(),
});
export type ListGroupMembersDto = z.infer<typeof ListGroupMembersSchema>;
