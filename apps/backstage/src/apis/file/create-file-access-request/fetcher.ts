import { defineAuthFetcher, jsonBody } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getFileFolderGrantControllerRequestAccessUrl } from '@/shared/api-sdk';
import type { CreateFileAccessRequest, FileAccessRequestSubmitted } from '@/shared/api-sdk';

import type { InWorkspace } from '../types';

/** 申請資料夾存取（審批類型 `fileFolder.access`）；已有待審時 `submitted: false`。 */
export const fetchFileAccessRequestCreateMutation = defineAuthFetcher<
  HttpRequestDTO<InWorkspace & { folderId: string; body: CreateFileAccessRequest }>,
  FileAccessRequestSubmitted
>((http, request) =>
  http.request(
    getFileFolderGrantControllerRequestAccessUrl({
      workspaceId: request.params.workspaceId,
      id: request.params.folderId,
    }),
    jsonBody(request.params.body, { method: 'POST' }),
  ),
);
