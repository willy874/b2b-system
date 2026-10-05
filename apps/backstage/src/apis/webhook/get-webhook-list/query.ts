import type { HttpRequestDTO } from '@b2b-system/web-core/client';
import { keepPreviousData, queryOptions } from '@tanstack/react-query';

import type { WebhookListParams } from '../types';
import { fetchWebhookListQuery } from './fetcher';

export const WEBHOOK_LIST_QUERY_KEY = 'WEBHOOK_LIST_QUERY_KEY';

export const getWebhookListQueryOptions = (options: HttpRequestDTO<WebhookListParams>) =>
  queryOptions({
    queryKey: [
      WEBHOOK_LIST_QUERY_KEY,
      options.params.offset,
      options.params.limit,
      options.params.keyword,
      options.params.status,
    ] as const,
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) => fetchWebhookListQuery({ params: options.params, signal }),
  });
