import { defineAuthFetcher, withQuery } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getPlatformNotificationControllerListUrl } from '@/shared/api-sdk';
import type { PlatformNotificationControllerListResponse } from '@/shared/api-sdk';

import type { PlatformNotificationListParams } from '../types';

export const fetchNotificationListQuery = defineAuthFetcher<
  HttpRequestDTO<PlatformNotificationListParams>,
  PlatformNotificationControllerListResponse['data']
>((http, request) =>
  http.request(
    withQuery(getPlatformNotificationControllerListUrl(), {
      offset: request.params.offset,
      limit: request.params.limit,
      unread: request.params.unread ? 'true' : undefined,
    }),
    { method: 'GET' },
  ),
);
