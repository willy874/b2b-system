import { defineAuthFetcher } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getNotificationControllerUnreadCountUrl } from '@/shared/api-sdk';
import type { NotificationControllerUnreadCountResponse } from '@/shared/api-sdk';

export const fetchNotificationUnreadCountQuery = defineAuthFetcher<
  HttpRequestDTO<void>,
  NotificationControllerUnreadCountResponse['data']
>((http) => http.request(getNotificationControllerUnreadCountUrl(), { method: 'GET' }));
