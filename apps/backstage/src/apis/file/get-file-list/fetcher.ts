import { defineAuthFetcher, withQuery } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';
import { toSortParams } from '@b2b-system/web-shared/constants';

import { getFileControllerListUrl } from '@/shared/api-sdk';
import type { FileControllerListResponse } from '@/shared/api-sdk';

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
