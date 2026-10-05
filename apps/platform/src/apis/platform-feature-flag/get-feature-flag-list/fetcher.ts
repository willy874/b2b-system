import { defineAuthFetcher } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getPlatformFeatureFlagControllerListUrl } from '@/shared/api-sdk';
import type { FeatureFlagList } from '@/shared/api-sdk';

export const fetchFeatureFlagListQuery = defineAuthFetcher<HttpRequestDTO<void>, FeatureFlagList>(
  (http) => http.request(getPlatformFeatureFlagControllerListUrl(), { method: 'GET' }),
);
