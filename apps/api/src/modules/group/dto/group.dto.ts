import { z } from 'zod';

import { defineSchema } from '@/core/validation';

export const GroupSchema = defineSchema(
  'Group',
  z.object({
    id: z.string().uuid(),
    name: z.string(),
    description: z.string().nullable(),
    /** 直接成員數（使用者 ＋ 巢狀的群組；不展開巢狀群組的成員）。 */
    memberCount: z.number().int(),
    /** 群組持有的角色數。 */
    roleCount: z.number().int(),
    /** 樂觀鎖版本：`PATCH` 時帶上（docs/architecture/backend/14-revisions.md §9.2 D3）。 */
    version: z.number().int(),
    /**
     * 只在以 `userId` 篩選時出現：`direct` 是那位使用者直接所屬，`nested` 是經由他所屬的群組（巢狀）而屬於。
     */
    membership: z.enum(['direct', 'nested']).optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
  }),
);

/** `POST /groups/:id/restore` 的回應：還原後的群組（刪除時保留的成員與持有的角色一起生效）。 */
export const RestoredGroupSchema = defineSchema('RestoredGroup', GroupSchema);

/** 群組的一個直接成員：使用者或巢狀的群組。 */
export const GroupMemberSchema = defineSchema(
  'GroupMember',
  z.object({
    type: z.enum(['user', 'group']),
    id: z.string().uuid(),
    /** 使用者的顯示名稱，或群組名稱。 */
    name: z.string(),
    /** 只有使用者有。 */
    email: z.string().nullable(),
    /** 只有使用者有。 */
    status: z.enum(['pending', 'active', 'inactive', 'locked']).nullable(),
  }),
);

export const GroupRoleSchema = defineSchema(
  'GroupRole',
  z.object({
    id: z.string().uuid(),
    slug: z.string(),
    name: z.string(),
    isSystem: z.boolean(),
  }),
);

/** `GET`／`PATCH /groups/:id/roles` 的回應。 */
export const GroupRolesSchema = defineSchema(
  'GroupRoles',
  z.object({ roles: z.array(GroupRoleSchema) }),
);

export type GroupDto = z.infer<typeof GroupSchema>;
export type GroupMemberDto = z.infer<typeof GroupMemberSchema>;
export type GroupRoleDto = z.infer<typeof GroupRoleSchema>;
export type GroupRolesDto = z.infer<typeof GroupRolesSchema>;
