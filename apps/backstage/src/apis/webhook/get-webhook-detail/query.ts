import { queryOptions } from '@tanstack/react-query';

import { fetchWebhookDetailQuery } from './fetcher';

export const WEBHOOK_DETAIL_QUERY_KEY = 'WEBHOOK_DETAIL_QUERY_KEY';

export const getWebhookDetailQueryOptions = (webhookId: string) =>
  queryOptions({
    queryKey: [WEBHOOK_DETAIL_QUERY_KEY, webhookId] as const,
    queryFn: ({ queryKey, signal }) =>
      fetchWebhookDetailQuery({ params: { webhookId: queryKey[1] }, signal }),
  });
