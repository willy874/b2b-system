import { defineAuthFetcher } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getNotificationControllerUnreadCountUrl } from '@/shared/api-sdk';
import type { NotificationControllerUnreadCountResponse } from '@/shared/api-sdk';

export const fetchNotificationUnreadCountQuery = defineAuthFetcher<
  HttpRequestDTO<void>,
  NotificationControllerUnreadCountResponse['data']
>((http) => http.request(getNotificationControllerUnreadCountUrl(), { method: 'GET' }));
