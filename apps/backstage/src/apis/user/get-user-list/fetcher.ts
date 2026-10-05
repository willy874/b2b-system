import { defineAuthFetcher, withQuery } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';
import { toSortParams } from '@b2b-system/web-shared/constants';

import { getUserControllerListUrl } from '@/shared/api-sdk';
import type { UserControllerListResponse } from '@/shared/api-sdk';

import type { UserListParams } from '../types';

export const fetchUserListQuery = defineAuthFetcher<
  HttpRequestDTO<UserListParams>,
  UserControllerListResponse['data']
>((http, request) =>
  http.request(
    withQuery(getUserControllerListUrl(), {
      ...request.params,
      sort: request.params.sort && toSortParams(request.params.sort),
    }),
    {
      method: 'GET',
    },
  ),
);
