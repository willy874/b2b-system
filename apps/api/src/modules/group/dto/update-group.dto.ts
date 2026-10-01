import { z } from 'zod';

import { defineSchema } from '@/core/validation';

import { GROUP_BATCH_LIMIT } from '../group.constants';
import { GroupNameSchema } from './create-group.dto';

export const UpdateGroupSchema = defineSchema(
  'UpdateGroupRequest',
  z
    .object({
      name: GroupNameSchema.optional(),
      description: z.string().trim().max(500).nullable().optional(),
      /** 樂觀鎖：編輯開始時看到的 `version`（必填）；不同回 409 `GROUP_VERSION_CONFLICT`（ADR-0025 D3）。 */
      version: z.number().int().min(1),
    })
    // `version` 不是要改的欄位：只帶它等於什麼都沒改
    .refine(({ version: _version, ...fields }) => Object.keys(fields).length > 0, {
      message: 'at least one field is required',
    }),
);

/** 群組成員：使用者，或另一個群組（巢狀，它的成員都算這個群組的成員）。 */
export const GroupMemberRefSchema = defineSchema(
  'GroupMemberRef',
  z.object({
    type: z.enum(['user', 'group']),
    id: z.string().uuid(),
  }),
);

const sameMember = (a: GroupMemberRef, b: GroupMemberRef) => a.type === b.type && a.id === b.id;

/**
 * 差異語意（與角色的權限相同）：整批取代在兩人同時編輯時會互相覆寫。
 * 同一個成員不能同時出現在 `add` 與 `remove`。
 */
export const UpdateGroupMembersSchema = defineSchema(
  'UpdateGroupMembersRequest',
  z
    .object({
      add: z.array(GroupMemberRefSchema).max(GROUP_BATCH_LIMIT).default([]),
      remove: z.array(GroupMemberRefSchema).max(GROUP_BATCH_LIMIT).default([]),
    })
    .refine(({ add, remove }) => !add.some((member) => remove.some((r) => sameMember(member, r))), {
      message: 'a member cannot be both added and removed',
      path: ['remove'],
    }),
);

export const UpdateGroupRolesSchema = defineSchema(
  'UpdateGroupRolesRequest',
  z
    .object({
      add: z.array(z.string().uuid()).max(GROUP_BATCH_LIMIT).default([]),
      remove: z.array(z.string().uuid()).max(GROUP_BATCH_LIMIT).default([]),
    })
    .refine(({ add, remove }) => !add.some((id) => remove.includes(id)), {
      message: 'a role cannot be both added and removed',
      path: ['remove'],
    }),
);

export type UpdateGroupDto = z.infer<typeof UpdateGroupSchema>;
export type GroupMemberRef = z.infer<typeof GroupMemberRefSchema>;
export type UpdateGroupMembersDto = z.infer<typeof UpdateGroupMembersSchema>;
export type UpdateGroupRolesDto = z.infer<typeof UpdateGroupRolesSchema>;
