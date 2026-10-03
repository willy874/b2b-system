import { z } from 'zod';

import { defineSchema } from '@/core/validation';

export const ListPlatformNotificationSchema = z.object({
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  /** `true`：只列未讀。 */
  unread: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
});

export const PlatformNotificationSchema = defineSchema(
  'PlatformNotification',
  z.object({
    id: z.string().uuid(),
    type: z.string(),
    params: z.record(z.string(), z.unknown()),
    link: z.object({ route: z.string(), params: z.record(z.string(), z.string()) }).nullable(),
    readAt: z.string().nullable(),
    createdAt: z.string(),
  }),
);

export const PlatformNotificationUnreadCountSchema = defineSchema(
  'PlatformNotificationUnreadCount',
  z.object({ count: z.number().int() }),
);

export type ListPlatformNotificationDto = z.infer<typeof ListPlatformNotificationSchema>;
export type PlatformNotificationDto = z.infer<typeof PlatformNotificationSchema>;
