import { defineAuthFetcher } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getFileFolderGrantControllerRevokeUrl } from '@/shared/api-sdk';

import type { FileGrantSubjectType, InWorkspace } from '../types';

/** 移除一筆直接授權（繼承來的要到來源資料夾移除）。 */
export const fetchFileFolderGrantDeleteMutation = defineAuthFetcher<
  HttpRequestDTO<
    InWorkspace & { folderId: string; subjectType: FileGrantSubjectType; subjectId: string }
  >,
  undefined
>((http, request) =>
  http.request(
    getFileFolderGrantControllerRevokeUrl({
      workspaceId: request.params.workspaceId,
      id: request.params.folderId,
      subjectType: request.params.subjectType,
      subjectId: request.params.subjectId,
    }),
    { method: 'DELETE' },
  ),
);
