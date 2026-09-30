import { defineAuthFetcher } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
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
