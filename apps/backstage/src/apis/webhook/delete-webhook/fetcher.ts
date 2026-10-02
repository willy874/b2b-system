import { defineAuthFetcher } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getWebhookControllerRemoveUrl } from '@/shared/api-sdk';

export const fetchWebhookDeleteMutation = defineAuthFetcher<
  HttpRequestDTO<{ webhookId: string }>,
  undefined
>((http, request) =>
  http.request(getWebhookControllerRemoveUrl({ id: request.params.webhookId }), {
    method: 'DELETE',
  }),
);
