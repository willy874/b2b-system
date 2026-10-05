import { defineAuthFetcher } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getWebhookControllerSendTestUrl } from '@/shared/api-sdk';
import type { WebhookTestResult } from '@/shared/api-sdk';

export const fetchWebhookTestSendMutation = defineAuthFetcher<
  HttpRequestDTO<{ webhookId: string }>,
  WebhookTestResult
>((http, request) =>
  http.request(getWebhookControllerSendTestUrl({ id: request.params.webhookId }), {
    method: 'POST',
  }),
);
