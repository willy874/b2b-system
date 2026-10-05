import { defineAuthFetcher } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getNotificationEventControllerListUrl } from '@/shared/api-sdk';
import type { NotificationEventList } from '@/shared/api-sdk';

export const fetchNotificationEventListQuery = defineAuthFetcher<
  HttpRequestDTO<void>,
  NotificationEventList
>((http) => http.request(getNotificationEventControllerListUrl(), { method: 'GET' }));
