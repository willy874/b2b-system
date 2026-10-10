import { useQuery } from '@tanstack/react-query';

import { getWebhookUrlLimitQueryOptions } from '@/apis/webhook/get-webhook-url-limit/query';

import { WEBHOOK_MAX_URLS_PER_SUBSCRIPTION } from '../constants';

/**
 * 這個訂閱最多能有幾個網址：每個訂閱的上限（10）與平台給租戶的額度（feature 參數 `webhook.maxUrls`，
 * docs/architecture/05-tenancy.md §15.2 D5）取小的。額度還沒取得時是 undefined，表單先不顯示「新增網址」，
 * 不讓人加了才在送出時收到 `WEBHOOK_URL_LIMIT_REACHED`。
 */
export function useWebhookUrlCapacity(subscriptionId?: string): number | undefined {
  const { data } = useQuery(getWebhookUrlLimitQueryOptions(subscriptionId));
  return data && Math.min(WEBHOOK_MAX_URLS_PER_SUBSCRIPTION, data.available);
}
