import { defineAuthFetcher, withQuery } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';
import { toSortParams } from '@b2b-system/web-shared/constants';

import { getServiceAccountControllerListUrl } from '@/shared/api-sdk';
import type { ServiceAccountControllerListResponse } from '@/shared/api-sdk';

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
