import { defineAuthFetcher, withQuery } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getUserControllerListUrl } from '@/shared/api-sdk';
import type { UserControllerListResponse } from '@/shared/api-sdk';

import type { UserListParams } from '../types';

export const fetchUserListQuery = defineAuthFetcher<
  HttpRequestDTO<UserListParams>,
  UserControllerListResponse['data']
>((http, request) =>
  http.request(withQuery(getUserControllerListUrl(), { ...request.params }), {
    method: 'GET',
  }),
);
