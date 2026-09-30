import { defineAuthFetcher } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getFileControllerRestoreUrl } from '@/shared/api-sdk';
import type { StoredFile } from '@/shared/api-sdk';

export const fetchFileRestoreMutation = defineAuthFetcher<
  HttpRequestDTO<{ fileId: string }>,
  StoredFile
>((http, request) =>
  http.request(getFileControllerRestoreUrl({ id: request.params.fileId }), { method: 'POST' }),
);
