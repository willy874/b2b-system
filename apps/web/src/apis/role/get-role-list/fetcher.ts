import { defineAuthFetcher, withQuery } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getRoleControllerListUrl } from '@/shared/api-sdk';
import type { RoleControllerListResponse } from '@/shared/api-sdk';

import type { RoleListParams } from '../types';

export const fetchRoleListQuery = defineAuthFetcher<
  HttpRequestDTO<RoleListParams>,
  RoleControllerListResponse['data']
>((http, request) =>
  http.request(withQuery(getRoleControllerListUrl(), { ...request.params }), {
    method: 'GET',
  }),
);
