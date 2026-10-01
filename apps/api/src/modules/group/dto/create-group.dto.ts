import { z } from 'zod';

import { defineSchema } from '@/core/validation';

/** 群組名稱：NFC 正規化（與角色名稱相同），唯一性另外不分大小寫。 */
export const GroupNameSchema = z.string().trim().normalize('NFC').min(1).max(64);

export const CreateGroupSchema = defineSchema(
  'CreateGroupRequest',
  z.object({
    name: GroupNameSchema,
    description: z.string().trim().max(500).optional(),
  }),
);

export type CreateGroupDto = z.infer<typeof CreateGroupSchema>;
