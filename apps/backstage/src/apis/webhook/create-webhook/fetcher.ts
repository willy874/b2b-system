import { defineAuthFetcher, jsonBody } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getWebhookControllerCreateUrl } from '@/shared/api-sdk';
import type { CreatedWebhook, CreateWebhookRequest } from '@/shared/api-sdk';

export const fetchWebhookCreateMutation = defineAuthFetcher<
  HttpRequestDTO<CreateWebhookRequest>,
  CreatedWebhook
>((http, request) =>
  http.request(getWebhookControllerCreateUrl(), jsonBody(request.params, { method: 'POST' })),
);
