import { defineAuthFetcher, withQuery } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getServiceAccountControllerListUrl } from '@/shared/api-sdk';
import type { ServiceAccountControllerListResponse } from '@/shared/api-sdk';
import { toSortParams } from '@/shared/constants';

import type { ServiceAccountListParams } from '../types';

export const fetchServiceAccountListQuery = defineAuthFetcher<
  HttpRequestDTO<ServiceAccountListParams>,
  ServiceAccountControllerListResponse['data']
>((http, request) =>
  http.request(
    withQuery(getServiceAccountControllerListUrl(), {
      ...request.params,
      sort: request.params.sort && toSortParams(request.params.sort),
    }),
    { method: 'GET' },
  ),
);
