import { defineAuthFetcher, withQuery } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getPlatformTenantControllerGetUsageUrl } from '@/shared/api-sdk';
import type { TenantUsage } from '@/shared/api-sdk';

export const fetchTenantUsageQuery = defineAuthFetcher<
  HttpRequestDTO<{ id: string; days: number }>,
  TenantUsage
>((http, request) =>
  http.request(
    withQuery(getPlatformTenantControllerGetUsageUrl({ id: request.params.id }), {
      days: request.params.days,
    }),
    { method: 'GET' },
  ),
);
