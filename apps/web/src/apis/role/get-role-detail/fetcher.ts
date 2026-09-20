import { defineAuthFetcher } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getRoleControllerFindOneUrl } from '@/shared/api-sdk';
import type { Role } from '@/shared/api-sdk';

export const fetchRoleDetailQuery = defineAuthFetcher<HttpRequestDTO<{ roleId: string }>, Role>(
  (http, request) =>
    http.request(getRoleControllerFindOneUrl(request.params.roleId), {
      method: 'GET',
      signal: request.signal,
    }),
);
