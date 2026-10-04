import { defineAuthFetcher } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getPlatformNotificationControllerMarkReadUrl } from '@/shared/api-sdk';

export const fetchMarkNotificationReadMutation = defineAuthFetcher<
  HttpRequestDTO<{ notificationId: string }>,
  { success: boolean }
>((http, request) =>
  http.request(
    getPlatformNotificationControllerMarkReadUrl({ id: request.params.notificationId }),
    {
      method: 'POST',
    },
  ),
);
