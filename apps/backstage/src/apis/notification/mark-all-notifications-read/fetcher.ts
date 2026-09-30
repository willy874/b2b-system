import { defineAuthFetcher } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getNotificationControllerReadAllUrl } from '@/shared/api-sdk';
import type { NotificationReadAllResult } from '@/shared/api-sdk';

export const fetchMarkAllNotificationsReadMutation = defineAuthFetcher<
  HttpRequestDTO<void>,
  NotificationReadAllResult
>((http) => http.request(getNotificationControllerReadAllUrl(), { method: 'POST' }));
