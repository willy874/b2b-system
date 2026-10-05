import { defineAuthFetcher } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getUserControllerRestoreUrl } from '@/shared/api-sdk';
import type { User } from '@/shared/api-sdk';

export const fetchUserRestoreMutation = defineAuthFetcher<HttpRequestDTO<{ userId: string }>, User>(
  (http, request) =>
    http.request(getUserControllerRestoreUrl({ id: request.params.userId }), { method: 'POST' }),
);
