import { defineAuthFetcher } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getWebhookControllerRotateSecretUrl } from '@/shared/api-sdk';
import type { WebhookSecret } from '@/shared/api-sdk';

export const fetchWebhookSecretRotateMutation = defineAuthFetcher<
  HttpRequestDTO<{ webhookId: string }>,
  WebhookSecret
>((http, request) =>
  http.request(getWebhookControllerRotateSecretUrl({ id: request.params.webhookId }), {
    method: 'POST',
  }),
);
