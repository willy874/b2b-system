import { defineAuthFetcher, withQuery } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getPlatformJobControllerListUrl } from '@/shared/api-sdk';
import type { PlatformJobControllerListResponse } from '@/shared/api-sdk';

import type { PlatformJobListParams } from '../types';

export const fetchPlatformJobListQuery = defineAuthFetcher<
  HttpRequestDTO<PlatformJobListParams>,
  PlatformJobControllerListResponse['data']
>((http, request) =>
  http.request(withQuery(getPlatformJobControllerListUrl(), { ...request.params }), {
    method: 'GET',
  }),
);
