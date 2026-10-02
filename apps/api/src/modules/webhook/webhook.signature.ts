import { createHmac, randomBytes } from 'node:crypto';

import { WEBHOOK_USER_AGENT } from './webhook.constants';

const SECRET_PREFIX = 'whsec_';

/** 新的簽章密鑰（docs/adr/0030-webhooks.md D14）：`whsec_` ＋ 32 bytes base64url。只在建立與輪替的回應出現一次。 */
export function generateWebhookSecret(): string {
  return `${SECRET_PREFIX}${randomBytes(32).toString('base64url')}`;
}

/**
 * `X-Webhook-Signature` 的值（D11）：`sha256=<hex(HMAC-SHA256(secret, "{timestamp}.{body}"))>`。
 * 時間戳在簽章裡：接收端驗簽後再拒絕過舊的時間戳，就能擋重放。
 */
export function signWebhook(secret: string, timestamp: number, body: string): string {
  const digest = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  return `sha256=${digest}`;
}

/** 對外事件的信封（D3）：`id` 是事件 id，重送時不變，接收端用來冪等。 */
export interface WebhookEnvelope {
  id: string;
  type: string;
  version: number;
  occurredAt: string;
  /** 租戶代碼：同一個接收端服務多個租戶時用來分辨。 */
  tenant: string;
  data: Record<string, unknown>;
}

/** 一次投遞的請求標頭。 */
export function webhookHeaders(
  envelope: WebhookEnvelope,
  secret: string,
  timestamp: number,
  body: string,
): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'User-Agent': WEBHOOK_USER_AGENT,
    'X-Webhook-Id': envelope.id,
    'X-Webhook-Event': envelope.type,
    'X-Webhook-Timestamp': String(timestamp),
    'X-Webhook-Signature': signWebhook(secret, timestamp, body),
  };
}
