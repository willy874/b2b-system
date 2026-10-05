import { defineAuthFetcher, withQuery } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getNotificationControllerListUrl } from '@/shared/api-sdk';
import type { NotificationControllerListResponse } from '@/shared/api-sdk';

import type { NotificationListParams } from '../types';

export const fetchNotificationListQuery = defineAuthFetcher<
  HttpRequestDTO<NotificationListParams>,
  NotificationControllerListResponse['data']
>((http, request) =>
  http.request(
    withQuery(getNotificationControllerListUrl(), {
      limit: request.params.limit,
      cursor: request.params.cursor,
      unread: request.params.filter === 'unread' ? 'true' : undefined,
    }),
    { method: 'GET' },
  ),
);
