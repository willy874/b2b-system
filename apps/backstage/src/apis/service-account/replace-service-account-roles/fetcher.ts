import { defineAuthFetcher, jsonBody } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getServiceAccountControllerReplaceRolesUrl } from '@/shared/api-sdk';
import type { ReplaceServiceAccountRolesRequest, ServiceAccountRoles } from '@/shared/api-sdk';

export const fetchServiceAccountRolesReplaceMutation = defineAuthFetcher<
  HttpRequestDTO<{ serviceAccountId: string; body: ReplaceServiceAccountRolesRequest }>,
  ServiceAccountRoles
>((http, request) =>
  http.request(
    getServiceAccountControllerReplaceRolesUrl({ id: request.params.serviceAccountId }),
    jsonBody(request.params.body, { method: 'PUT' }),
  ),
);
