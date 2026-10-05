import { defineAuthFetcher } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

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
