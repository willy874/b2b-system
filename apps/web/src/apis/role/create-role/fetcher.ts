import { defineAuthFetcher, jsonBody } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getRoleControllerCreateUrl } from '@/shared/api-sdk';
import type { CreateRoleRequest, Role } from '@/shared/api-sdk';

export const fetchRoleCreateMutation = defineAuthFetcher<HttpRequestDTO<CreateRoleRequest>, Role>(
  (http, request) =>
    http.request(getRoleControllerCreateUrl(), jsonBody(request.params, { method: 'POST' })),
);
