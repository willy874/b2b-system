import { defineAuthFetcher, withQuery } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getFileFolderGrantControllerExplainUrl } from '@/shared/api-sdk';
import type { FileAccessExplain } from '@/shared/api-sdk';

export const fetchFileFolderExplainQuery = defineAuthFetcher<
  HttpRequestDTO<{ folderId: string; userId: string }>,
  FileAccessExplain
>((http, request) =>
  http.request(
    withQuery(getFileFolderGrantControllerExplainUrl({ id: request.params.folderId }), {
      userId: request.params.userId,
    }),
    { method: 'GET' },
  ),
);
