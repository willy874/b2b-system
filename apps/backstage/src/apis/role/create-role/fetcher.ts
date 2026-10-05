import { defineAuthFetcher, jsonBody } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getRoleControllerCreateUrl } from '@/shared/api-sdk';
import type { CreateRoleRequest, Role } from '@/shared/api-sdk';

export const fetchRoleCreateMutation = defineAuthFetcher<HttpRequestDTO<CreateRoleRequest>, Role>(
  (http, request) =>
    http.request(getRoleControllerCreateUrl(), jsonBody(request.params, { method: 'POST' })),
);
