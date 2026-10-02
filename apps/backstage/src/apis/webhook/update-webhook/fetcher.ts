import { defineAuthFetcher, jsonBody } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getWebhookControllerUpdateUrl } from '@/shared/api-sdk';
import type { UpdateWebhookRequest, Webhook } from '@/shared/api-sdk';

export const fetchWebhookUpdateMutation = defineAuthFetcher<
  HttpRequestDTO<{ webhookId: string; body: UpdateWebhookRequest }>,
  Webhook
>((http, request) =>
  http.request(
    getWebhookControllerUpdateUrl({ id: request.params.webhookId }),
    jsonBody(request.params.body, { method: 'PATCH' }),
  ),
);
