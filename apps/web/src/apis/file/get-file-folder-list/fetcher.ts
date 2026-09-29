import { defineAuthFetcher } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getFileFolderControllerListUrl } from '@/shared/api-sdk';
import type { FileFolderList } from '@/shared/api-sdk';

import type { InWorkspace } from '../types';

export const fetchFileFolderListQuery = defineAuthFetcher<
  HttpRequestDTO<InWorkspace>,
  FileFolderList
>((http, request) =>
  http.request(getFileFolderControllerListUrl({ workspaceId: request.params.workspaceId }), {
    method: 'GET',
  }),
);
