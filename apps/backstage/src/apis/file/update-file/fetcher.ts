import { defineAuthFetcher, jsonBody } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

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
