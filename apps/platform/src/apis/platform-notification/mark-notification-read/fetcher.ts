import { defineAuthFetcher } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

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
