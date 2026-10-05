import { defineAuthFetcher, withQuery } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';
import { toSortParams } from '@b2b-system/web-shared/constants';

import { getRoleControllerListUrl } from '@/shared/api-sdk';
import type { RoleControllerListResponse } from '@/shared/api-sdk';

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
