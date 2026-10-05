import { defineAuthFetcher, jsonBody } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

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
