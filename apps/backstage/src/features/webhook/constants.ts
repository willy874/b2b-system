import type { ChipTone } from '@/components/Chip';
import type { Webhook, WebhookDelivery } from '@/shared/api-sdk';

type WebhookStatus = Webhook['status'];

/** 狀態的文字（字面量 key，docs/conventions/06-literal-strings.md）。 */
export const WEBHOOK_STATUS_LABEL_KEY = {
  active: 'webhook.status.active',
  disabled: 'webhook.status.disabled',
} as const satisfies Record<WebhookStatus, string>;

export const WEBHOOK_STATUS_TONE = {
  active: 'success',
  disabled: 'neutral',
} as const satisfies Record<WebhookStatus, ChipTone>;

/** 停用的原因（docs/adr/0030-webhooks.md D13）。 */
export const WEBHOOK_DISABLED_REASON_KEY = {
  manual: 'webhook.disabledReason.manual',
  failing: 'webhook.disabledReason.failing',
} as const satisfies Record<NonNullable<Webhook['disabledReason']>, string>;

export const WEBHOOK_DELIVERY_TRIGGER_KEY = {
  auto: 'webhook.delivery.trigger.auto',
  manual: 'webhook.delivery.trigger.manual',
} as const satisfies Record<WebhookDelivery['trigger'], string>;

/** 一個對外事件在畫面上的名稱與說明。 */
export interface WebhookEventLabel {
  nameKey: string;
  descriptionKey: string;
}

/**
 * 對外事件的顯示文字（key 與後端的 `type` 相同，docs/adr/0030-webhooks.md D2）。後端新增了這裡沒有的事件時，
 * 以 `type` 本身當名稱，照常可以訂閱。
 */
export const WEBHOOK_EVENT_LABEL: Readonly<Partial<Record<string, WebhookEventLabel>>> = {
  'user.created': {
    nameKey: 'webhook.event.userCreated.name',
    descriptionKey: 'webhook.event.userCreated.description',
  },
  'user.statusChanged': {
    nameKey: 'webhook.event.userStatusChanged.name',
    descriptionKey: 'webhook.event.userStatusChanged.description',
  },
  'user.deleted': {
    nameKey: 'webhook.event.userDeleted.name',
    descriptionKey: 'webhook.event.userDeleted.description',
  },
  'user.restored': {
    nameKey: 'webhook.event.userRestored.name',
    descriptionKey: 'webhook.event.userRestored.description',
  },
  'approval.decided': {
    nameKey: 'webhook.event.approvalDecided.name',
    descriptionKey: 'webhook.event.approvalDecided.description',
  },
  'file.uploaded': {
    nameKey: 'webhook.event.fileUploaded.name',
    descriptionKey: 'webhook.event.fileUploaded.description',
  },
  'webhook.ping': {
    nameKey: 'webhook.event.webhookPing.name',
    descriptionKey: 'webhook.event.webhookPing.description',
  },
};

/** 投遞紀錄每頁幾筆。 */
export const WEBHOOK_DELIVERY_PAGE_SIZE = 20;

/** 自動停用的門檻（與後端 `WEBHOOK_AUTO_DISABLE_AFTER_FAILURES` 一致，只用於說明文字）。 */
export const WEBHOOK_AUTO_DISABLE_AFTER_FAILURES = 50;

/** 一個訂閱最多幾個目標網址（與後端 `WEBHOOK_MAX_URLS_PER_SUBSCRIPTION` 一致；ADR-0033 D13）。 */
export const WEBHOOK_MAX_URLS_PER_SUBSCRIPTION = 10;

/** 網址長度上限（與後端 `WEBHOOK_URL_MAX_LENGTH` 一致）。 */
export const WEBHOOK_URL_MAX_LENGTH = 2000;
