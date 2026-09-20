import { defineAuthFetcher } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getUserControllerResetPasswordUrl } from '@/shared/api-sdk';

export const fetchUserResetPasswordMutation = defineAuthFetcher<
  HttpRequestDTO<{ userId: string }>,
  { sent: boolean }
>((http, request) =>
  http.request(getUserControllerResetPasswordUrl(request.params.userId), { method: 'POST' }),
);
