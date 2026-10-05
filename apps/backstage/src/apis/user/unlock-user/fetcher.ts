import { defineAuthFetcher } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getUserControllerUnlockUrl } from '@/shared/api-sdk';
import type { User } from '@/shared/api-sdk';

export const fetchUserUnlockMutation = defineAuthFetcher<HttpRequestDTO<{ userId: string }>, User>(
  (http, request) =>
    http.request(getUserControllerUnlockUrl({ id: request.params.userId }), { method: 'POST' }),
);
