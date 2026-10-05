import { defineAuthFetcher, withQuery } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getWebhookControllerListUrl } from '@/shared/api-sdk';
import type { WebhookControllerListResponse } from '@/shared/api-sdk';

import type { WebhookListParams } from '../types';

export const fetchWebhookListQuery = defineAuthFetcher<
  HttpRequestDTO<WebhookListParams>,
  WebhookControllerListResponse['data']
>((http, request) =>
  http.request(withQuery(getWebhookControllerListUrl(), { ...request.params }), { method: 'GET' }),
);
