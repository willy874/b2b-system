import { defineAuthFetcher, withQuery } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';
import { toSortParams } from '@b2b-system/web-shared/constants';

import { getApprovalControllerListUrl } from '@/shared/api-sdk';
import type { ApprovalControllerListResponse } from '@/shared/api-sdk';

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
