import { defineAuthFetcher } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getPlatformNotificationControllerMarkAllReadUrl } from '@/shared/api-sdk';

export const fetchMarkAllNotificationsReadMutation = defineAuthFetcher<
  HttpRequestDTO<void>,
  { updated: number }
>((http) => http.request(getPlatformNotificationControllerMarkAllReadUrl(), { method: 'POST' }));
