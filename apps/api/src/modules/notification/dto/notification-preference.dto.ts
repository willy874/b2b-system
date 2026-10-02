import { z } from 'zod';

import { defineSchema } from '@/core/validation';

import { NOTIFICATION_EVENT_MAX_CHANGES } from '../notification.constants';
import { NotificationChannelSchema } from './notification-event.dto';

/** 個人不能調整的原因（docs/architecture/backend/16-notification-event.md §9.2 D14）。 */
export const NOTIFICATION_PREFERENCE_LOCKS = [
  'mandatory',
  'tenantDisabled',
  'tenantRequired',
] as const;

export type NotificationPreferenceLock = (typeof NOTIFICATION_PREFERENCE_LOCKS)[number];

export const NotificationPreferenceChannelSchema = defineSchema(
  'NotificationPreferenceChannel',
  z.object({
    channel: NotificationChannelSchema,
    /** 生效值：會不會送給自己。 */
    enabled: z.boolean(),
    /** 自己有覆寫（關掉了租戶開啟的管道）。 */
    isOverridden: z.boolean(),
    /**
     * 不能調整的原因；`null` 是可以調整。`mandatory`：安全事件；`tenantDisabled`：租戶關掉了（一律不送）；
     * `tenantRequired`：租戶要求每個人都收到。
     */
    lock: z.enum(NOTIFICATION_PREFERENCE_LOCKS).nullable(),
  }),
);

export const NotificationPreferenceSchema = defineSchema(
  'NotificationPreference',
  z.object({
    type: z.string(),
    category: z.string(),
    channels: z.array(NotificationPreferenceChannelSchema),
  }),
);

export const NotificationPreferenceListSchema = defineSchema(
  'NotificationPreferenceList',
  z.object({ items: z.array(NotificationPreferenceSchema) }),
);

export const UpdateNotificationPreferencesSchema = defineSchema(
  'UpdateNotificationPreferencesRequest',
  z.object({
    changes: z
      .array(
        z.object({
          type: z.string().trim().min(1).max(100),
          channel: NotificationChannelSchema,
          /** `null`：還原成跟著租戶。 */
          enabled: z.boolean().nullable(),
        }),
      )
      .min(1)
      .max(NOTIFICATION_EVENT_MAX_CHANGES)
      .refine(
        (changes) =>
          new Set(changes.map((change) => `${change.type} ${change.channel}`)).size ===
          changes.length,
        { message: 'duplicate type and channel' },
      ),
  }),
);

export type NotificationPreferenceChannelDto = z.infer<typeof NotificationPreferenceChannelSchema>;
export type NotificationPreferenceDto = z.infer<typeof NotificationPreferenceSchema>;
export type NotificationPreferenceListDto = z.infer<typeof NotificationPreferenceListSchema>;
export type UpdateNotificationPreferencesDto = z.infer<typeof UpdateNotificationPreferencesSchema>;
