import { defineAuthFetcher, withQuery } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getJobControllerListUrl } from '@/shared/api-sdk';
import type { JobControllerListResponse } from '@/shared/api-sdk';

import type { JobListParams } from '../types';

export const fetchJobListQuery = defineAuthFetcher<
  HttpRequestDTO<JobListParams>,
  JobControllerListResponse['data']
>((http, request) =>
  http.request(withQuery(getJobControllerListUrl(), { ...request.params }), { method: 'GET' }),
);
