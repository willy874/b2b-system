import type { WebhookDelivery } from '@/shared/api-sdk';

export interface WebhookDeliveryRowVM {
  id: string;
  eventId: string;
  eventType: string;
  eventData: Record<string, unknown>;
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
    attempt: dto.attempt,
    trigger: dto.trigger,
    succeeded: dto.succeeded,
    result: dto.responseStatus !== null ? String(dto.responseStatus) : (dto.error ?? '-'),
    durationMs: dto.durationMs,
    responseBody: dto.responseBody,
    createdAt: new Date(dto.createdAt),
  };
}
