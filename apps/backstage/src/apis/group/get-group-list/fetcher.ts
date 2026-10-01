import { defineAuthFetcher, withQuery } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getGroupControllerListUrl } from '@/shared/api-sdk';
import type { GroupControllerListResponse } from '@/shared/api-sdk';
import { toSortParams } from '@/shared/constants';

import type { GroupListParams } from '../types';

export const fetchGroupListQuery = defineAuthFetcher<
  HttpRequestDTO<GroupListParams>,
  GroupControllerListResponse['data']
>((http, request) =>
  http.request(
    withQuery(getGroupControllerListUrl(), {
      ...request.params,
      sort: request.params.sort && toSortParams(request.params.sort),
    }),
    { method: 'GET' },
  ),
);
