import { z } from 'zod';

import { defineSchema } from '@/core/validation';

export const CreateUserSchema = defineSchema(
  'CreateUserRequest',
  z.object({
    email: z.string().trim().email().max(255),
    username: z.string().trim().min(3).max(50).optional(),
    displayName: z.string().trim().min(1).max(100),
    roleIds: z.array(z.string().uuid()).max(20).default([]),
  }),
);

export type CreateUserDto = z.infer<typeof CreateUserSchema>;
