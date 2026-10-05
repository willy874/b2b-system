import { defineAuthFetcher, withQuery } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

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
