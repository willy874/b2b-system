import { queryOptions } from '@tanstack/react-query';

import { fetchWebhookEventsQuery } from './fetcher';

export const WEBHOOK_EVENTS_QUERY_KEY = 'WEBHOOK_EVENTS_QUERY_KEY';

/** 可訂閱的事件：由程式碼決定（docs/adr/0030-webhooks.md D1），只隨租戶啟用的 feature 改變。 */
export const getWebhookEventsQueryOptions = () =>
  queryOptions({
    queryKey: [WEBHOOK_EVENTS_QUERY_KEY] as const,
    staleTime: 5 * 60 * 1000,
    queryFn: ({ signal }) => fetchWebhookEventsQuery({ params: undefined, signal }),
  });
