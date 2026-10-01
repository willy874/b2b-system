import { z } from 'zod';

import { defineSchema } from '@/core/validation';

import { NOTIFICATION_EVENT_MAX_CHANGES } from '../notification.constants';
import { NOTIFICATION_CHANNELS } from '../notification.definition';

const NotificationChannelSchema = defineSchema(
  'NotificationChannel',
  z.enum(NOTIFICATION_CHANNELS),
);

export const NotificationEventChannelSchema = defineSchema(
  'NotificationEventChannel',
  z.object({
    channel: NotificationChannelSchema,
    /** 生效值：`mandatory` 一律 `true`；有覆寫就是覆寫值，否則是預設值。 */
    enabled: z.boolean(),
    defaultEnabled: z.boolean(),
    isOverridden: z.boolean(),
    /** 覆寫值最後修改的時間；沒有覆寫時為 `null`。 */
    updatedAt: z.string().nullable(),
  }),
);

export const NotificationEventSchema = defineSchema(
  'NotificationEvent',
  z.object({
    /** `<模組>.<事件>`（與通知的 `type` 相同）；前端依它找名稱與說明的 i18n key。 */
    type: z.string(),
    /** 管理頁的分組（camelCase）。 */
    category: z.string(),
    /** 不能關：開關停用（ADR-0028 D4）。 */
    mandatory: z.boolean(),
    /** 這個事件能經由的管道（目錄的順序）。 */
    channels: z.array(NotificationEventChannelSchema),
  }),
);

export const NotificationEventListSchema = defineSchema(
  'NotificationEventList',
  z.object({ items: z.array(NotificationEventSchema) }),
);

const NotificationEventChangeSchema = z.object({
  type: z.string().trim().min(1).max(100),
  channel: NotificationChannelSchema,
  /** `null`：還原預設（刪掉覆寫值）。 */
  enabled: z.boolean().nullable(),
});

export const UpdateNotificationEventsSchema = defineSchema(
  'UpdateNotificationEventsRequest',
  z.object({
    changes: z
      .array(NotificationEventChangeSchema)
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

export type NotificationEventChannelDto = z.infer<typeof NotificationEventChannelSchema>;
export type NotificationEventDto = z.infer<typeof NotificationEventSchema>;
export type NotificationEventListDto = z.infer<typeof NotificationEventListSchema>;
export type UpdateNotificationEventsDto = z.infer<typeof UpdateNotificationEventsSchema>;
