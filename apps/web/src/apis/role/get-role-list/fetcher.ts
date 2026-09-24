import { defineAuthFetcher, withQuery } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getRoleControllerListUrl } from '@/shared/api-sdk';
import type { RoleControllerList200Data } from '@/shared/api-sdk';

import type { RoleListParams } from '../types';

export const fetchRoleListQuery = defineAuthFetcher<
  HttpRequestDTO<RoleListParams>,
  RoleControllerList200Data
>((http, request) =>
  http.request(withQuery(getRoleControllerListUrl(), { ...request.params }), {
    method: 'GET',
  }),
);
