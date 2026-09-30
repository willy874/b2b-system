import { defineAuthFetcher, withQuery } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getTrashControllerListUrl } from '@/shared/api-sdk';
import type { TrashControllerListResponse } from '@/shared/api-sdk';

import type { TrashListParams } from '../types';

export const fetchTrashListQuery = defineAuthFetcher<
  HttpRequestDTO<TrashListParams>,
  TrashControllerListResponse['data']
>((http, request) =>
  http.request(withQuery(getTrashControllerListUrl(), { ...request.params }), { method: 'GET' }),
);
