import { defineAuthFetcher } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getUserControllerRestoreUrl } from '@/shared/api-sdk';
import type { User } from '@/shared/api-sdk';

export const fetchUserRestoreMutation = defineAuthFetcher<HttpRequestDTO<{ userId: string }>, User>(
  (http, request) =>
    http.request(getUserControllerRestoreUrl({ id: request.params.userId }), { method: 'POST' }),
);
