import { defineAuthFetcher } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getNotificationPreferenceControllerListUrl } from '@/shared/api-sdk';
import type { NotificationPreferenceList } from '@/shared/api-sdk';

export const fetchNotificationPreferenceListQuery = defineAuthFetcher<
  HttpRequestDTO<void>,
  NotificationPreferenceList
>((http) => http.request(getNotificationPreferenceControllerListUrl(), { method: 'GET' }));
