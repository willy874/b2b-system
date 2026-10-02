import { defineAuthFetcher, withQuery } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getNotificationOverviewControllerListAllUrl } from '@/shared/api-sdk';
import type { NotificationOverviewControllerListAllResponse } from '@/shared/api-sdk';

import type { NotificationOverviewParams } from '../types';

export const fetchNotificationOverviewQuery = defineAuthFetcher<
  HttpRequestDTO<NotificationOverviewParams>,
  NotificationOverviewControllerListAllResponse['data']
>((http, request) =>
  http.request(
    withQuery(getNotificationOverviewControllerListAllUrl(), {
      limit: request.params.limit,
      cursor: request.params.cursor,
      type: request.params.type,
      recipientId: request.params.recipientId,
      unread: request.params.unread ? 'true' : undefined,
      from: request.params.from,
      to: request.params.to,
    }),
    { method: 'GET' },
  ),
);
