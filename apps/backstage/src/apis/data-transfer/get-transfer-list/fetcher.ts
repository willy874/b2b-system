import { defineAuthFetcher, withQuery } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getDataTransferControllerListUrl } from '@/shared/api-sdk';
import type { DataTransferControllerListResponse } from '@/shared/api-sdk';

import type { DataTransferListParams } from '../types';

export const fetchTransferListQuery = defineAuthFetcher<
  HttpRequestDTO<DataTransferListParams>,
  DataTransferControllerListResponse['data']
>((http, request) =>
  http.request(withQuery(getDataTransferControllerListUrl(), { ...request.params }), {
    method: 'GET',
  }),
);
