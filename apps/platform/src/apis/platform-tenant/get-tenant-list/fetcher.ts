import { defineAuthFetcher, withQuery } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

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
