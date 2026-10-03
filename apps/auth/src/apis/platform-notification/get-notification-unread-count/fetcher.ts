import { defineAuthFetcher } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getPlatformNotificationControllerUnreadCountUrl } from '@/shared/api-sdk';
import type { PlatformNotificationControllerUnreadCountResponse } from '@/shared/api-sdk';

export const fetchNotificationUnreadCountQuery = defineAuthFetcher<
  HttpRequestDTO<void>,
  PlatformNotificationControllerUnreadCountResponse['data']
>((http) => http.request(getPlatformNotificationControllerUnreadCountUrl(), { method: 'GET' }));
