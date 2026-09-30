import { defineAuthFetcher, withQuery } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getFileControllerListUrl } from '@/shared/api-sdk';
import type { FileControllerListResponse } from '@/shared/api-sdk';
import { toSortParams } from '@/shared/constants';

import type { FileListParams } from '../types';

export const fetchFileListQuery = defineAuthFetcher<
  HttpRequestDTO<FileListParams>,
  FileControllerListResponse['data']
>((http, request) =>
  http.request(
    withQuery(getFileControllerListUrl(), {
      ...request.params,
      sort: request.params.sort && toSortParams(request.params.sort),
    }),
    { method: 'GET' },
  ),
);
