import { defineWebhookEvent } from './webhook.definition';

/** 一個租戶的訂閱上限：每個事件會對每個訂閱入列一筆工作，數量要有邊界。 */
export const WEBHOOK_MAX_SUBSCRIPTIONS = 50;

/** 連續失敗幾次自動停用（docs/adr/0030-webhooks.md D13）：約 6 個事件各自用完 8 次重試。 */
export const WEBHOOK_AUTO_DISABLE_AFTER_FAILURES = 50;

/** 一次投遞的總逾時（D11）。 */
export const WEBHOOK_DELIVERY_TIMEOUT_MS = 10_000;

/** 投遞紀錄保留回應的前幾個位元組（D11）。 */
export const WEBHOOK_RESPONSE_EXCERPT_BYTES = 1024;

/** 事件與投遞紀錄保留天數（D16）。 */
export const WEBHOOK_RETENTION_DAYS = 30;

/** 清理每批最多刪幾筆事件（投遞紀錄隨事件 CASCADE）。 */
export const WEBHOOK_CLEANUP_BATCH_SIZE = 1000;

/** 網址長度上限。 */
export const WEBHOOK_URL_MAX_LENGTH = 2000;

/** 送出的 `User-Agent`：接收端可以用它辨識來源與格式版本。 */
export const WEBHOOK_USER_AGENT = 'b2b-system-webhook/1';

/**
 * 測試事件（D2、D17）：只由「送測試事件」發出，不能訂閱。`data` 帶觸發的訂閱 id，
 * 接收端可以用它確認簽章與網址都設定正確。
 */
export const WEBHOOK_PING_EVENT = defineWebhookEvent<{ webhookId: string }>('webhook.ping', {
  version: 1,
  subscribable: false,
});

/** 訂閱的稽核欄位：`diff()` 只比這些（密鑰不進稽核）。 */
export const WEBHOOK_AUDIT_FIELDS = ['name', 'url', 'events', 'status'] as const;
