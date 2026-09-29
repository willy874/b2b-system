import { defineAuthFetcher, withQuery } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getRoleControllerListUrl } from '@/shared/api-sdk';
import type { RoleControllerListResponse } from '@/shared/api-sdk';
import { toSortParams } from '@/shared/constants';

import type { RoleListParams } from '../types';

export const fetchRoleListQuery = defineAuthFetcher<
  HttpRequestDTO<RoleListParams>,
  RoleControllerListResponse['data']
>((http, request) =>
  http.request(
    withQuery(getRoleControllerListUrl(), {
      ...request.params,
      sort: request.params.sort && toSortParams(request.params.sort),
    }),
    {
      method: 'GET',
    },
  ),
);
