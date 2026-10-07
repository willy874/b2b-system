import { defineAuthFetcher } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getNotificationControllerRemoveUrl } from '@/shared/api-sdk';

export const fetchDeleteNotificationMutation = defineAuthFetcher<
  HttpRequestDTO<{ notificationId: string }>,
  undefined
>((http, request) =>
  http.request(getNotificationControllerRemoveUrl({ id: request.params.notificationId }), {
    method: 'DELETE',
  }),
);
