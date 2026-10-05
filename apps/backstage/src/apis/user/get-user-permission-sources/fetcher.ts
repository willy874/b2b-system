import { defineAuthFetcher } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getAuthzExplainControllerPermissionSourcesUrl } from '@/shared/api-sdk';
import type { PermissionSources } from '@/shared/api-sdk';

export const fetchUserPermissionSourcesQuery = defineAuthFetcher<
  HttpRequestDTO<{ userId: string }>,
  PermissionSources
>((http, request) =>
  http.request(getAuthzExplainControllerPermissionSourcesUrl({ id: request.params.userId }), {
    method: 'GET',
  }),
);
