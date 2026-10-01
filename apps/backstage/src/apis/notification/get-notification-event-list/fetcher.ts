import { defineAuthFetcher } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getNotificationEventControllerListUrl } from '@/shared/api-sdk';
import type { NotificationEventList } from '@/shared/api-sdk';

export const fetchNotificationEventListQuery = defineAuthFetcher<
  HttpRequestDTO<void>,
  NotificationEventList
>((http) => http.request(getNotificationEventControllerListUrl(), { method: 'GET' }));
