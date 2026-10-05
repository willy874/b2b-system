import { defineAuthFetcher, withQuery } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';
import { toSortParams } from '@b2b-system/web-shared/constants';

import { getGroupControllerListUrl } from '@/shared/api-sdk';
import type { GroupControllerListResponse } from '@/shared/api-sdk';

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
