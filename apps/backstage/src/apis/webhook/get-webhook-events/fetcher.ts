import { defineAuthFetcher } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getWebhookControllerListEventsUrl } from '@/shared/api-sdk';
import type { WebhookEventList } from '@/shared/api-sdk';

export const fetchWebhookEventsQuery = defineAuthFetcher<
  HttpRequestDTO<undefined>,
  WebhookEventList
>((http) => http.request(getWebhookControllerListEventsUrl(), { method: 'GET' }));
