import { queryOptions } from '@tanstack/react-query';

import { fetchWebhookUrlLimitQuery } from './fetcher';

export const WEBHOOK_URL_LIMIT_QUERY_KEY = 'WEBHOOK_URL_LIMIT_QUERY_KEY';

/**
 * 這個訂閱還能有幾個網址（feature 參數 `webhook.maxUrls` 扣掉其他訂閱已用的，docs/architecture/05-tenancy.md §15.2 D5）。
 * 任何訂閱的網址改變都會影響它，所以掛在 webhook 的 collection 上失效（`apis/resources.ts`）。
 */
export const getWebhookUrlLimitQueryOptions = (subscriptionId?: string) =>
  queryOptions({
    queryKey: [WEBHOOK_URL_LIMIT_QUERY_KEY, subscriptionId ?? ''] as const,
    queryFn: ({ queryKey, signal }) =>
      fetchWebhookUrlLimitQuery({
        params: queryKey[1] ? { subscriptionId: queryKey[1] } : {},
        signal,
      }),
  });
