import { defineAuthFetcher, jsonBody } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getFileFolderControllerRenameUrl } from '@/shared/api-sdk';
import type { FileFolder, UpdateFileFolderRequest } from '@/shared/api-sdk';

export const fetchFileFolderUpdateMutation = defineAuthFetcher<
  HttpRequestDTO<{ folderId: string; body: UpdateFileFolderRequest }>,
  FileFolder
>((http, request) =>
  http.request(
    getFileFolderControllerRenameUrl({ id: request.params.folderId }),
    jsonBody(request.params.body, { method: 'PATCH' }),
  ),
);
