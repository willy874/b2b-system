import { defineAuthFetcher, withQuery } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getPlatformTenantControllerListUrl } from '@/shared/api-sdk';
import type { PlatformTenantList } from '@/shared/api-sdk';

import type { TenantListParams } from '../types';

export const fetchTenantListQuery = defineAuthFetcher<
  HttpRequestDTO<TenantListParams>,
  PlatformTenantList
>((http, request) =>
  http.request(withQuery(getPlatformTenantControllerListUrl(), { ...request.params }), {
    method: 'GET',
  }),
);
