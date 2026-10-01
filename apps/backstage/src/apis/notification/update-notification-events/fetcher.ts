import { defineAuthFetcher, jsonBody } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
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
