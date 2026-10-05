import { defineAuthFetcher, jsonBody } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getNotificationEventControllerUpdateUrl } from '@/shared/api-sdk';
import type { NotificationEventList, UpdateNotificationEventsRequest } from '@/shared/api-sdk';

export const fetchUpdateNotificationEventsMutation = defineAuthFetcher<
  HttpRequestDTO<UpdateNotificationEventsRequest>,
  NotificationEventList
>((http, request) =>
  http.request(
    getNotificationEventControllerUpdateUrl(),
    jsonBody(request.params, { method: 'PATCH' }),
  ),
);
