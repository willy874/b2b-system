import { defineAuthFetcher, withQuery } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getUserControllerListUrl } from '@/shared/api-sdk';
import type { UserControllerList200Data } from '@/shared/api-sdk';

import type { UserListParams } from '../types';

export const fetchUserListQuery = defineAuthFetcher<
  HttpRequestDTO<UserListParams>,
  UserControllerList200Data
>((http, request) =>
  http.request(withQuery(getUserControllerListUrl(), { ...request.params }), {
    method: 'GET',
    signal: request.signal,
  }),
);
