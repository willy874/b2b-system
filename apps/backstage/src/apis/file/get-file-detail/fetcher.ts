import { defineAuthFetcher } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getFileControllerFindOneUrl } from '@/shared/api-sdk';
import type { StoredFile } from '@/shared/api-sdk';

export const fetchFileDetailQuery = defineAuthFetcher<
  HttpRequestDTO<{ fileId: string }>,
  StoredFile
>((http, request) =>
  http.request(getFileControllerFindOneUrl({ id: request.params.fileId }), { method: 'GET' }),
);
