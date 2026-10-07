import { defineAuthFetcher } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getPlatformTenantControllerFeatureImpactUrl } from '@/shared/api-sdk';
import type { TenantFeature, TenantFeatureImpact } from '@/shared/api-sdk';

export const fetchTenantFeatureImpactQuery = defineAuthFetcher<
  HttpRequestDTO<{ id: string; feature: TenantFeature }>,
  TenantFeatureImpact
>((http, request) =>
  http.request(
    getPlatformTenantControllerFeatureImpactUrl({
      id: request.params.id,
      feature: request.params.feature,
    }),
    { method: 'GET' },
  ),
);
