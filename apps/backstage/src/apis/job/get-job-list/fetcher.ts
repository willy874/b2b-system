import { defineAuthFetcher, withQuery } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getJobControllerListUrl } from '@/shared/api-sdk';
import type { JobControllerListResponse } from '@/shared/api-sdk';

import type { JobListParams } from '../types';

export const fetchJobListQuery = defineAuthFetcher<
  HttpRequestDTO<JobListParams>,
  JobControllerListResponse['data']
>((http, request) =>
  http.request(withQuery(getJobControllerListUrl(), { ...request.params }), { method: 'GET' }),
);
