import { defineAuthFetcher, jsonBody } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getNotificationPreferenceControllerUpdateUrl } from '@/shared/api-sdk';
import type {
  NotificationPreferenceList,
  UpdateNotificationPreferencesRequest,
} from '@/shared/api-sdk';

export const fetchUpdateNotificationPreferencesMutation = defineAuthFetcher<
  HttpRequestDTO<UpdateNotificationPreferencesRequest>,
  NotificationPreferenceList
>((http, request) =>
  http.request(
    getNotificationPreferenceControllerUpdateUrl(),
    jsonBody(request.params, { method: 'PATCH' }),
  ),
);
