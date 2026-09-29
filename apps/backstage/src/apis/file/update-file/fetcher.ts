import { defineAuthFetcher, jsonBody } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getFileControllerUpdateUrl } from '@/shared/api-sdk';
import type { StoredFile, UpdateFileRequest } from '@/shared/api-sdk';

export const fetchFileUpdateMutation = defineAuthFetcher<
  HttpRequestDTO<{ fileId: string; body: UpdateFileRequest }>,
  StoredFile
>((http, request) =>
  http.request(
    getFileControllerUpdateUrl({ id: request.params.fileId }),
    jsonBody(request.params.body, { method: 'PATCH' }),
  ),
);
