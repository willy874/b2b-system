import { defineAuthFetcher, withQuery } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getWebhookControllerListUrl } from '@/shared/api-sdk';
import type { WebhookControllerListResponse } from '@/shared/api-sdk';

import type { WebhookListParams } from '../types';

export const fetchWebhookListQuery = defineAuthFetcher<
  HttpRequestDTO<WebhookListParams>,
  WebhookControllerListResponse['data']
>((http, request) =>
  http.request(withQuery(getWebhookControllerListUrl(), { ...request.params }), { method: 'GET' }),
);
