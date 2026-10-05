import { defineAuthFetcher, withQuery } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getTrashControllerListUrl } from '@/shared/api-sdk';
import type { TrashControllerListResponse } from '@/shared/api-sdk';

import type { TrashListParams } from '../types';

export const fetchTrashListQuery = defineAuthFetcher<
  HttpRequestDTO<TrashListParams>,
  TrashControllerListResponse['data']
>((http, request) =>
  http.request(withQuery(getTrashControllerListUrl(), { ...request.params }), { method: 'GET' }),
);
