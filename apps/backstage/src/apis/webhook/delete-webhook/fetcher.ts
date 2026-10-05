import { defineAuthFetcher } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getWebhookControllerRemoveUrl } from '@/shared/api-sdk';

export const fetchWebhookDeleteMutation = defineAuthFetcher<
  HttpRequestDTO<{ webhookId: string }>,
  undefined
>((http, request) =>
  http.request(getWebhookControllerRemoveUrl({ id: request.params.webhookId }), {
    method: 'DELETE',
  }),
);
