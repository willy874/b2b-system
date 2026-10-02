import { defineAuthFetcher } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getWebhookControllerSendTestUrl } from '@/shared/api-sdk';
import type { WebhookDelivery } from '@/shared/api-sdk';

export const fetchWebhookTestSendMutation = defineAuthFetcher<
  HttpRequestDTO<{ webhookId: string }>,
  WebhookDelivery
>((http, request) =>
  http.request(getWebhookControllerSendTestUrl({ id: request.params.webhookId }), {
    method: 'POST',
  }),
);
