import { defineAuthFetcher, jsonBody } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getUserControllerCreateUrl } from '@/shared/api-sdk';
import type { CreateUserRequest, User } from '@/shared/api-sdk';

export const fetchUserCreateMutation = defineAuthFetcher<HttpRequestDTO<CreateUserRequest>, User>(
  (http, request) =>
    http.request(getUserControllerCreateUrl(), jsonBody(request.params, { method: 'POST' })),
);
