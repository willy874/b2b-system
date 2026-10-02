import { z } from 'zod';

import { PaginationSchema } from '@/core/http';
import { defineSchema } from '@/core/validation';

import { WEBHOOK_URL_MAX_LENGTH } from '../webhook.constants';

export const WebhookStatusSchema = z.enum(['active', 'disabled']);

/** 停用的原因（docs/adr/0030-webhooks.md D13）：有人停用，或連續失敗自動停用。 */
export const WebhookDisabledReasonSchema = z.enum(['manual', 'failing']);

/** 事件名稱：格式由目錄決定，這裡只擋明顯不對的值。 */
const EventNameSchema = z.string().trim().min(1).max(100);

const EventsSchema = z
  .array(EventNameSchema)
  .min(1)
  .max(50)
  .refine((events) => new Set(events).size === events.length, { message: 'duplicate events' });

export const WebhookSchema = defineSchema(
  'Webhook',
  z.object({
    id: z.string().uuid(),
    name: z.string(),
    url: z.string(),
    /** 訂閱的事件；目錄上已經沒有的名稱不列出。 */
    events: z.array(z.string()),
    status: WebhookStatusSchema,
    disabledReason: WebhookDisabledReasonSchema.nullable(),
    /** 連續失敗的投遞次數；到 50 次自動停用（D13）。 */
    consecutiveFailures: z.number().int(),
    lastDeliveryAt: z.string().nullable(),
    /** 樂觀鎖版本：`PATCH` 時帶上（ADR-0025 D3）。 */
    version: z.number().int(),
    createdAt: z.string(),
    updatedAt: z.string(),
    createdBy: z.object({ id: z.string().uuid(), displayName: z.string() }).nullable(),
  }),
);

export const ListWebhookSchema = PaginationSchema.extend({
  keyword: z.string().trim().max(100).optional(),
  status: WebhookStatusSchema.optional(),
});

export const CreateWebhookSchema = defineSchema(
  'CreateWebhookRequest',
  z.object({
    name: z.string().trim().min(1).max(100),
    /** production 只接受 https，不能帶帳密、不能解析到內網位址（D15）。 */
    url: z.string().trim().min(1).max(WEBHOOK_URL_MAX_LENGTH),
    events: EventsSchema,
  }),
);

export const UpdateWebhookSchema = defineSchema(
  'UpdateWebhookRequest',
  z
    .object({
      name: z.string().trim().min(1).max(100).optional(),
      url: z.string().trim().min(1).max(WEBHOOK_URL_MAX_LENGTH).optional(),
      events: EventsSchema.optional(),
      /** 啟用時失敗次數歸零（D13）；停用的原因記為 `manual`。 */
      status: WebhookStatusSchema.optional(),
      /** 樂觀鎖：編輯開始時看到的 `version`（必填）。 */
      version: z.number().int().min(1),
    })
    .refine(
      (dto) =>
        dto.name !== undefined ||
        dto.url !== undefined ||
        dto.events !== undefined ||
        dto.status !== undefined,
      { message: 'at least one field' },
    ),
);

/** 建立的回應：`secret` 只出現這一次，資料庫只存加密後的值（D14）。 */
export const CreatedWebhookSchema = defineSchema(
  'CreatedWebhook',
  z.object({ secret: z.string(), webhook: WebhookSchema }),
);

/** 輪替密鑰的回應：新的 `secret` 只出現這一次，舊的立即失效（D14）。 */
export const WebhookSecretSchema = defineSchema(
  'WebhookSecret',
  z.object({ secret: z.string(), webhook: WebhookSchema }),
);

/** 訂閱頁可以選的事件（可訂閱、所屬 feature 已啟用）；說明文字在前端依名稱翻譯。 */
export const WebhookEventListSchema = defineSchema(
  'WebhookEventList',
  z.object({ items: z.array(z.object({ type: z.string(), version: z.number().int() })) }),
);

export const WebhookDeliveryTriggerSchema = z.enum(['auto', 'manual']);

export const WebhookDeliverySchema = defineSchema(
  'WebhookDelivery',
  z.object({
    id: z.string().uuid(),
    /** 事件 id：重送時不變（即送出的 `X-Webhook-Id`）。 */
    eventId: z.string().uuid(),
    eventType: z.string(),
    /** 送出的 `data`（只有 id 與列舉值，D3）。 */
    eventData: z.record(z.string(), z.unknown()),
    occurredAt: z.string(),
    /** 這個事件對這個訂閱的第幾次嘗試。 */
    attempt: z.number().int(),
    trigger: WebhookDeliveryTriggerSchema,
    succeeded: z.boolean(),
    /** 沒有收到回應（逾時、連線失敗、被擋下）時為 null，原因在 `error`。 */
    responseStatus: z.number().int().nullable(),
    durationMs: z.number().int(),
    /** 回應內容的開頭（最多 1 KB）。 */
    responseBody: z.string().nullable(),
    error: z.string().nullable(),
    createdAt: z.string(),
  }),
);

export const ListWebhookDeliverySchema = PaginationSchema.extend({
  /** `true` 只列成功、`false` 只列失敗。 */
  succeeded: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
});

export type WebhookDto = z.infer<typeof WebhookSchema>;
export type WebhookStatus = z.infer<typeof WebhookStatusSchema>;
export type WebhookDisabledReason = z.infer<typeof WebhookDisabledReasonSchema>;
export type ListWebhookDto = z.infer<typeof ListWebhookSchema>;
export type CreateWebhookDto = z.infer<typeof CreateWebhookSchema>;
export type UpdateWebhookDto = z.infer<typeof UpdateWebhookSchema>;
export type CreatedWebhookDto = z.infer<typeof CreatedWebhookSchema>;
export type WebhookSecretDto = z.infer<typeof WebhookSecretSchema>;
export type WebhookEventListDto = z.infer<typeof WebhookEventListSchema>;
export type WebhookDeliveryDto = z.infer<typeof WebhookDeliverySchema>;
export type WebhookDeliveryTrigger = z.infer<typeof WebhookDeliveryTriggerSchema>;
export type ListWebhookDeliveryDto = z.infer<typeof ListWebhookDeliverySchema>;
