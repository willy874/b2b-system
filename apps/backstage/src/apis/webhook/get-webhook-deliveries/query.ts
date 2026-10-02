import { keepPreviousData, queryOptions } from '@tanstack/react-query';

import type { HttpRequestDTO } from '@/core/client';

import type { WebhookDeliveryListParams } from '../types';
import { fetchWebhookDeliveriesQuery } from './fetcher';

/** 第二個元素是 webhook id：依賴圖以 `[KEY, webhookId]` 失效某個 webhook 的投遞紀錄。 */
export const WEBHOOK_DELIVERIES_QUERY_KEY = 'WEBHOOK_DELIVERIES_QUERY_KEY';

export const getWebhookDeliveriesQueryOptions = (
  options: HttpRequestDTO<WebhookDeliveryListParams>,
) =>
  queryOptions({
    queryKey: [
      WEBHOOK_DELIVERIES_QUERY_KEY,
      options.params.webhookId,
      options.params.offset,
      options.params.limit,
      options.params.succeeded,
      options.params.targetId,
    ] as const,
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) => fetchWebhookDeliveriesQuery({ params: options.params, signal }),
  });
