import { defineAuthFetcher, withQuery } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';
import { toSortParams } from '@b2b-system/web-shared/constants';

import { getPlatformTenantControllerListUrl } from '@/shared/api-sdk';
import type { PlatformTenantList } from '@/shared/api-sdk';

import type { TenantListParams } from '../types';

export const fetchTenantListQuery = defineAuthFetcher<
  HttpRequestDTO<TenantListParams>,
  PlatformTenantList
>((http, request) =>
  http.request(
    withQuery(getPlatformTenantControllerListUrl(), {
      ...request.params,
      sort: request.params.sort?.length ? toSortParams(request.params.sort) : undefined,
    }),
    { method: 'GET' },
  ),
);
