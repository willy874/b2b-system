import { defineAuthFetcher, withQuery } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getApprovalControllerListUrl } from '@/shared/api-sdk';
import type { ApprovalControllerListResponse } from '@/shared/api-sdk';
import { toSortParams } from '@/shared/constants';

import type { ApprovalListParams } from '../types';

export const fetchApprovalListQuery = defineAuthFetcher<
  HttpRequestDTO<ApprovalListParams>,
  ApprovalControllerListResponse['data']
>((http, request) =>
  http.request(
    withQuery(getApprovalControllerListUrl(), {
      ...request.params,
      sort: request.params.sort && toSortParams(request.params.sort),
    }),
    { method: 'GET' },
  ),
);
