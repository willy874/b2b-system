import { defineAuthFetcher } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getWebhookControllerRedeliverUrl } from '@/shared/api-sdk';
import type { WebhookDelivery } from '@/shared/api-sdk';

export const fetchWebhookRedeliverMutation = defineAuthFetcher<
  HttpRequestDTO<{ webhookId: string; deliveryId: string }>,
  WebhookDelivery
>((http, request) =>
  http.request(
    getWebhookControllerRedeliverUrl({
      id: request.params.webhookId,
      deliveryId: request.params.deliveryId,
    }),
    { method: 'POST' },
  ),
);
