import { defineAuthFetcher } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getFileFolderGrantControllerListAccessRequestsUrl } from '@/shared/api-sdk';
import type { FileAccessRequestList } from '@/shared/api-sdk';

export const fetchFileAccessRequestListQuery = defineAuthFetcher<
  HttpRequestDTO<{ folderId: string }>,
  FileAccessRequestList
>((http, request) =>
  http.request(getFileFolderGrantControllerListAccessRequestsUrl({ id: request.params.folderId }), {
    method: 'GET',
  }),
);
