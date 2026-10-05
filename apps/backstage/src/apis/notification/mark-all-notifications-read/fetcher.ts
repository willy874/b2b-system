import { defineAuthFetcher } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getNotificationControllerReadAllUrl } from '@/shared/api-sdk';
import type { NotificationReadAllResult } from '@/shared/api-sdk';

export const fetchMarkAllNotificationsReadMutation = defineAuthFetcher<
  HttpRequestDTO<void>,
  NotificationReadAllResult
>((http) => http.request(getNotificationControllerReadAllUrl(), { method: 'POST' }));
