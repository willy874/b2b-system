import { defineAuthFetcher, jsonBody } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getUserControllerUpdateUrl } from '@/shared/api-sdk';
import type { UpdateUserRequest, User } from '@/shared/api-sdk';

export const fetchUserUpdateMutation = defineAuthFetcher<
  HttpRequestDTO<{ userId: string; body: UpdateUserRequest }>,
  User
>((http, request) =>
  http.request(
    getUserControllerUpdateUrl({ id: request.params.userId }),
    jsonBody(request.params.body, { method: 'PATCH' }),
  ),
);
