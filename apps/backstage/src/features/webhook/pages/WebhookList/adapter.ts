import type { Webhook } from '@/shared/api-sdk';

export interface WebhookRowVM {
  id: string;
  name: string;
  url: string;
  status: Webhook['status'];
  disabledReason: Webhook['disabledReason'];
  eventCount: number;
  consecutiveFailures: number;
  lastDeliveryAt: Date | null;
}

/** adapter 是後端契約變動的緩衝層：欄位改名時只有這裡要改。 */
export function toWebhookRowVM(dto: Webhook): WebhookRowVM {
  return {
    id: dto.id,
    name: dto.name,
    url: dto.url,
    status: dto.status,
    disabledReason: dto.disabledReason,
    eventCount: dto.events.length,
    consecutiveFailures: dto.consecutiveFailures,
    lastDeliveryAt: dto.lastDeliveryAt ? new Date(dto.lastDeliveryAt) : null,
  };
}
