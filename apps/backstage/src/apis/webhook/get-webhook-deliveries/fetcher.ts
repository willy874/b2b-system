import { defineAuthFetcher, withQuery } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getWebhookControllerListDeliveriesUrl } from '@/shared/api-sdk';
import type { WebhookControllerListDeliveriesResponse } from '@/shared/api-sdk';

import type { WebhookDeliveryListParams } from '../types';

export const fetchWebhookDeliveriesQuery = defineAuthFetcher<
  HttpRequestDTO<WebhookDeliveryListParams>,
  WebhookControllerListDeliveriesResponse['data']
>((http, request) => {
  const { webhookId, succeeded, ...page } = request.params;
  return http.request(
    withQuery(getWebhookControllerListDeliveriesUrl({ id: webhookId }), {
      ...page,
      succeeded: succeeded === undefined ? undefined : String(succeeded),
    }),
    { method: 'GET' },
  );
});
