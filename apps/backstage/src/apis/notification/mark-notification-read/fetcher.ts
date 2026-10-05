import { defineAuthFetcher } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getNotificationControllerReadUrl } from '@/shared/api-sdk';
import type { Notification } from '@/shared/api-sdk';

export const fetchMarkNotificationReadMutation = defineAuthFetcher<
  HttpRequestDTO<{ notificationId: string }>,
  Notification
>((http, request) =>
  http.request(getNotificationControllerReadUrl({ id: request.params.notificationId }), {
    method: 'POST',
  }),
);
