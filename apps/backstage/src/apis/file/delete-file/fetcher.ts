import { defineAuthFetcher } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getFileControllerRemoveUrl } from '@/shared/api-sdk';

export const fetchFileDeleteMutation = defineAuthFetcher<
  HttpRequestDTO<{ fileId: string }>,
  undefined
>((http, request) =>
  http.request(getFileControllerRemoveUrl({ id: request.params.fileId }), { method: 'DELETE' }),
);
