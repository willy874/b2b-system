import type { WebhookDelivery } from '@/shared/api-sdk';

export interface WebhookDeliveryRowVM {
  id: string;
  eventId: string;
  eventType: string;
  eventData: Record<string, unknown>;
  /** 送到的網址；網址已從訂閱移除時仍是當時的網址（docs/architecture/backend/17-webhook.md §10.2 D14）。 */
  url: string;
  attempt: number;
  trigger: WebhookDelivery['trigger'];
  succeeded: boolean;
  /** 狀態碼，或沒有收到回應時的原因代碼（`TIMEOUT`、`BLOCKED`…）。 */
  result: string;
  durationMs: number;
  responseBody: string | null;
  createdAt: Date;
}

export function toWebhookDeliveryRowVM(dto: WebhookDelivery): WebhookDeliveryRowVM {
  return {
    id: dto.id,
    eventId: dto.eventId,
    eventType: dto.eventType,
    eventData: dto.eventData,
    url: dto.url,
    attempt: dto.attempt,
    trigger: dto.trigger,
    succeeded: dto.succeeded,
    result: dto.responseStatus !== null ? String(dto.responseStatus) : (dto.error ?? '-'),
    durationMs: dto.durationMs,
    responseBody: dto.responseBody,
    createdAt: new Date(dto.createdAt),
  };
}

/** 兩組事件是否相同（不看順序）：編輯時判斷有沒有修改用，勾選的順序不影響投遞。 */
export function sameEvents(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(b);
  return a.every((event) => set.has(event));
}
