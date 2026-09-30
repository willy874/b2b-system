import { z } from 'zod';

import { defineSchema } from '@/core/validation';

import { NOTIFICATION_PAGE_DEFAULT, NOTIFICATION_PAGE_MAX } from '../notification.constants';

/** `GET /notifications` 的查詢：keyset 分頁（通知只往下捲，不跳頁、不計總數）。 */
export const ListNotificationSchema = z.object({
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(NOTIFICATION_PAGE_MAX)
    .default(NOTIFICATION_PAGE_DEFAULT),
  /** 上一頁回應的 `nextCursor`；不帶是第一頁（最新的）。 */
  cursor: z.string().trim().max(200).optional(),
  /** `true`：只列未讀。 */
  unread: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
});

export const NotificationLinkSchema = defineSchema(
  'NotificationLink',
  z.object({
    /** 前端的 route id（例：`approval.detail`）；前端找不到就只顯示文字、不可點（ADR-0026 D3）。 */
    route: z.string(),
    params: z.record(z.string(), z.string()),
  }),
);

export const NotificationSchema = defineSchema(
  'Notification',
  z.object({
    id: z.string().uuid(),
    /** `<模組>.<事件>`（例：`approval.pending`）；前端依它找句子的 i18n key，不認得的顯示通用文字。 */
    type: z.string(),
    /** 組句子用的名稱快照；形狀由 `type` 決定（docs/architecture/backend/15-notification.md §4）。 */
    params: z.record(z.string(), z.unknown()),
    link: NotificationLinkSchema.nullable(),
    /** 觸發的人；系統或那個人已被永久刪除時為 null。 */
    actor: z.object({ id: z.string().uuid(), name: z.string() }).nullable(),
    readAt: z.string().nullable(),
    createdAt: z.string(),
  }),
);

export const NotificationPageSchema = defineSchema(
  'NotificationPage',
  z.object({
    items: z.array(NotificationSchema),
    /** 下一頁的游標（`GET /notifications?cursor=`）；沒有下一頁時為 null。 */
    nextCursor: z.string().nullable(),
  }),
);

export const NotificationUnreadCountSchema = defineSchema(
  'NotificationUnreadCount',
  z.object({ count: z.number().int() }),
);

export const NotificationReadAllResultSchema = defineSchema(
  'NotificationReadAllResult',
  z.object({
    /** 這次被標為已讀的筆數。 */
    updated: z.number().int(),
  }),
);

export type ListNotificationDto = z.infer<typeof ListNotificationSchema>;
export type NotificationDto = z.infer<typeof NotificationSchema>;
export type NotificationPageDto = z.infer<typeof NotificationPageSchema>;
