import { defineAuthFetcher } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getWebhookControllerFindOneUrl } from '@/shared/api-sdk';
import type { Webhook } from '@/shared/api-sdk';

export const fetchWebhookDetailQuery = defineAuthFetcher<
  HttpRequestDTO<{ webhookId: string }>,
  Webhook
>((http, request) =>
  http.request(getWebhookControllerFindOneUrl({ id: request.params.webhookId }), {
    method: 'GET',
  }),
);
