import type { Webhook } from '@/shared/api-sdk';

export interface WebhookListParams {
  offset: number;
  limit: number;
  keyword?: string;
  status?: Webhook['status'];
}

export interface WebhookDeliveryListParams {
  webhookId: string;
  offset: number;
  limit: number;
  /** `true` 只列成功、`false` 只列失敗；省略是全部。 */
  succeeded?: boolean;
}
