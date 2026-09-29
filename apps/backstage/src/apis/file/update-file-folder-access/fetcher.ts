import { defineAuthFetcher, jsonBody } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getFileFolderGrantControllerSetInheritanceUrl } from '@/shared/api-sdk';
import type { FileFolderGrantList, UpdateFileFolderAccessRequest } from '@/shared/api-sdk';

import type { InWorkspace } from '../types';

/** 中斷／恢復繼承；中斷時後端把目前繼承到的授權複製成直接授權。 */
export const fetchFileFolderAccessUpdateMutation = defineAuthFetcher<
  HttpRequestDTO<InWorkspace & { folderId: string; body: UpdateFileFolderAccessRequest }>,
  FileFolderGrantList
>((http, request) =>
  http.request(
    getFileFolderGrantControllerSetInheritanceUrl({
      workspaceId: request.params.workspaceId,
      id: request.params.folderId,
    }),
    jsonBody(request.params.body, { method: 'PATCH' }),
  ),
);
