import { defineAuthFetcher, jsonBody } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getFileFolderControllerEnsurePathsUrl } from '@/shared/api-sdk';
import type { EnsureFileFolderPathsRequest, FileFolderPaths } from '@/shared/api-sdk';

import type { InWorkspace } from '../types';

/** 上傳資料夾前一次建好整棵結構；已存在的同名資料夾沿用。 */
export const fetchFileFolderEnsurePathsMutation = defineAuthFetcher<
  HttpRequestDTO<InWorkspace & EnsureFileFolderPathsRequest>,
  FileFolderPaths
>((http, request) => {
  const { workspaceId, ...body } = request.params;
  return http.request(
    getFileFolderControllerEnsurePathsUrl({ workspaceId }),
    jsonBody(body, { method: 'POST' }),
  );
});
