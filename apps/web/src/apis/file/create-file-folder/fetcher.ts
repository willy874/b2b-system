import { defineAuthFetcher, jsonBody } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getFileFolderControllerCreateUrl } from '@/shared/api-sdk';
import type { CreateFileFolderRequest, FileFolder } from '@/shared/api-sdk';

import type { InWorkspace } from '../types';

export const fetchFileFolderCreateMutation = defineAuthFetcher<
  HttpRequestDTO<InWorkspace & CreateFileFolderRequest>,
  FileFolder
>((http, request) => {
  const { workspaceId, ...body } = request.params;
  return http.request(
    getFileFolderControllerCreateUrl({ workspaceId }),
    jsonBody(body, { method: 'POST' }),
  );
});
