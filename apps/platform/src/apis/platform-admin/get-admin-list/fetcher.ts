import { defineAuthFetcher } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getPlatformAdminControllerListUrl } from '@/shared/api-sdk';
import type { PlatformAdminList } from '@/shared/api-sdk';

export const fetchAdminListQuery = defineAuthFetcher<HttpRequestDTO<void>, PlatformAdminList>(
  (http) => http.request(getPlatformAdminControllerListUrl(), { method: 'GET' }),
);
