import { defineAuthFetcher } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getUserControllerResetPasswordUrl } from '@/shared/api-sdk';

export const fetchUserResetPasswordMutation = defineAuthFetcher<
  HttpRequestDTO<{ userId: string }>,
  { sent: boolean }
>((http, request) =>
  http.request(getUserControllerResetPasswordUrl({ id: request.params.userId }), {
    method: 'POST',
  }),
);
