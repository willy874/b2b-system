import { defineAuthFetcher } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getUserControllerRemoveUrl } from '@/shared/api-sdk';

export const fetchUserDeleteMutation = defineAuthFetcher<
  HttpRequestDTO<{ userId: string }>,
  undefined
>((http, request) =>
  http.request(getUserControllerRemoveUrl(request.params.userId), { method: 'DELETE' }),
);
