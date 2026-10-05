import { defineAuthFetcher } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getPlatformNotificationControllerUnreadCountUrl } from '@/shared/api-sdk';
import type { PlatformNotificationControllerUnreadCountResponse } from '@/shared/api-sdk';

export const fetchNotificationUnreadCountQuery = defineAuthFetcher<
  HttpRequestDTO<void>,
  PlatformNotificationControllerUnreadCountResponse['data']
>((http) => http.request(getPlatformNotificationControllerUnreadCountUrl(), { method: 'GET' }));
