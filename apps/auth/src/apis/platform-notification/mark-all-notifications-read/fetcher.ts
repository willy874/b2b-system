import { defineAuthFetcher } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getPlatformNotificationControllerMarkAllReadUrl } from '@/shared/api-sdk';

export const fetchMarkAllNotificationsReadMutation = defineAuthFetcher<
  HttpRequestDTO<void>,
  { updated: number }
>((http) => http.request(getPlatformNotificationControllerMarkAllReadUrl(), { method: 'POST' }));
