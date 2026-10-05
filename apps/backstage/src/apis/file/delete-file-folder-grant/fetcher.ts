import { defineAuthFetcher } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getFileFolderGrantControllerRevokeUrl } from '@/shared/api-sdk';

import type { FileGrantSubjectType } from '../types';

/** 移除一筆直接授權（繼承來的要到來源資料夾移除）。 */
export const fetchFileFolderGrantDeleteMutation = defineAuthFetcher<
  HttpRequestDTO<{ folderId: string; subjectType: FileGrantSubjectType; subjectId: string }>,
  undefined
>((http, request) =>
  http.request(
    getFileFolderGrantControllerRevokeUrl({
      id: request.params.folderId,
      subjectType: request.params.subjectType,
      subjectId: request.params.subjectId,
    }),
    { method: 'DELETE' },
  ),
);
