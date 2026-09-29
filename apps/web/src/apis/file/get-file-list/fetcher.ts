import { defineAuthFetcher, withQuery } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getFileControllerListUrl } from '@/shared/api-sdk';
import type { FileControllerListResponse } from '@/shared/api-sdk';
import { toSortParams } from '@/shared/constants';

import type { FileListParams, InWorkspace } from '../types';

export const fetchFileListQuery = defineAuthFetcher<
  HttpRequestDTO<InWorkspace & FileListParams>,
  FileControllerListResponse['data']
>((http, request) => {
  const { workspaceId, ...query } = request.params;
  return http.request(
    withQuery(getFileControllerListUrl({ workspaceId }), {
      ...query,
      sort: query.sort && toSortParams(query.sort),
    }),
    { method: 'GET' },
  );
});
